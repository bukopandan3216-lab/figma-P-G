-- Supplier -> brand -> product -> variant ownership migration.
--
-- A brand now belongs to exactly one supplier (brands.supplier_id NOT NULL) and
-- products/variants inherit that owner through the brand. The redundant
-- supplier_products many-to-many table is removed. Product variants are
-- size-only: the unused scent column is dropped.

begin;

-- 1. Reassign the 12 brands: each supplier starts with 2 unique brands.
with mapping(brand_name, supplier_name) as (
  values
    ('Olay', 'Procter & Gamble Philippines Inc.'),
    ('Pantene', 'Procter & Gamble Philippines Inc.'),
    ('Always', 'Puregold Price Club Inc.'),
    ('Tampax', 'Puregold Price Club Inc.'),
    ('Head & Shoulders', 'Robinsons Retail Holdings Inc.'),
    ('Secret', 'Robinsons Retail Holdings Inc.'),
    ('SK-II', 'Rustan Commercial Corporation'),
    ('Old Spice', 'Rustan Commercial Corporation'),
    ('Ivory', 'SM Retail Inc.'),
    ('Gillette', 'SM Retail Inc.'),
    ('Oral-B', 'Watsons Philippines'),
    ('Crest', 'Watsons Philippines')
)
update public.brands b
set supplier_id = s.supplier_id
from mapping m
join public.suppliers s on s.name = m.supplier_name
where lower(btrim(b.name)) = lower(btrim(m.brand_name));

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.brands where supplier_id is null;
  if v_missing > 0 then
    raise exception '% brand(s) could not be assigned to a supplier', v_missing;
  end if;
end;
$$;

-- 2. Enforce ownership and size-only variants.
alter table public.brands alter column supplier_id set not null;
alter table public.products alter column brand_id set not null;
alter table public.product_variants alter column size set not null;
alter table public.product_variants drop column if exists scent;
drop index if exists public.product_variants_combo_unique_idx;
create unique index if not exists product_variants_size_unique_idx
  on public.product_variants (product_id, lower(btrim(size)));
-- Purchase order creation (staff with purchases/create permission).
-- Variant-level lines: every item names the exact variant being ordered, the
-- product is cross-checked against it, the product's brand must belong to the
-- selected supplier, and unit_cost is read from the hidden
-- product_variants.supplier_price â€” the client never sends a cost, so a PO
-- can never be booked below the supplier price.
create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_expected_delivery date,
  p_payment_terms text,
  p_notes text,
  p_items jsonb
) returns public.purchase_orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_item jsonb;
  v_supplier_name text;
  v_product_name text;
  v_variant_id uuid;
  v_product_id uuid;
  v_item_product_id uuid;
  v_quantity integer;
  v_unit_cost numeric;
  v_total numeric := 0;
  v_po_no text;
begin
  if not public.has_permission('purchases', 'create') then
    raise exception using errcode = '42501', message = 'Purchase order management access required';
  end if;

  select name into v_supplier_name
  from public.suppliers where supplier_id = p_supplier_id and status = 'Active';
  if v_supplier_name is null then
    raise exception 'Select an active supplier';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Purchase order items must be a list';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one variant to the purchase order';
  end if;

  v_po_no := 'PO-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.purchase_orders (
    created_by, supplier_id, status, total_cost, po_no,
    expected_delivery, payment_terms, notes
  ) values (
    auth.uid(), p_supplier_id, 'Pending', 0, v_po_no,
    p_expected_delivery, coalesce(p_payment_terms, ''), coalesce(p_notes, '')
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each purchase order item must be an object';
    end if;

    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    if v_variant_id is null then
      raise exception 'Each item requires a variant';
    end if;

    v_quantity := nullif(v_item ->> 'quantity', '')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Each item requires a positive quantity';
    end if;

    -- The line is identified by its variant; the hidden cost comes with it.
    select pv.product_id, pv.supplier_price
      into v_product_id, v_unit_cost
    from public.product_variants pv
    where pv.variant_id = v_variant_id;
    if v_product_id is null then
      raise exception 'One of the selected variants no longer exists';
    end if;

    v_item_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    if v_item_product_id is not null and v_item_product_id <> v_product_id then
      raise exception 'The selected variant does not belong to the chosen product';
    end if;

    select name into v_product_name
    from public.products where product_id = v_product_id and status = 'Active';
    if v_product_name is null then
      raise exception 'Purchase order products must be active';
    end if;

    -- Ownership is brand-based: the product's brand belongs to this supplier.
    if not exists (
      select 1
      from public.products p
      join public.brands b on b.brand_id = p.brand_id
      where p.product_id = v_product_id and b.supplier_id = p_supplier_id
    ) then
      raise exception '% does not provide %', v_supplier_name, v_product_name;
    end if;

    insert into public.purchase_order_items (purchase_order_id, product_id, variant_id, quantity, unit_cost)
    values (v_order.purchase_order_id, v_product_id, v_variant_id, v_quantity, v_unit_cost);

    v_total := v_total + v_quantity * v_unit_cost;
  end loop;

  update public.purchase_orders set total_cost = v_total where purchase_order_id = v_order.purchase_order_id returning * into v_order;
  return v_order;
end;
$$;

-- Supplier catalog helper: creates one brand that belongs to exactly one
-- supplier, plus that brand's products and size variants. The hierarchy is
-- enforced here for both new suppliers and additional brands.
create or replace function public._create_brand_catalog(
  p_supplier_id uuid,
  p_brand_name text,
  p_products jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_brand_id uuid;
  v_product jsonb;
  v_variant jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_price numeric;
  v_min_price numeric;
  v_size text;
  v_expiry date;
  v_category_id uuid;
  v_product_name text;
begin
  if p_supplier_id is null then
    raise exception 'Choose a supplier.';
  end if;
  if coalesce(btrim(p_brand_name), '') = '' then
    raise exception 'Brand name is required.';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then
    raise exception 'Add at least one product for this brand.';
  end if;
  if exists (select 1 from public.brands where lower(btrim(name)) = lower(btrim(p_brand_name))) then
    raise exception 'Brand "%" already exists. Every supplier needs a unique brand.', btrim(p_brand_name);
  end if;

  insert into public.brands (name, supplier_id)
  values (btrim(p_brand_name), p_supplier_id)
  returning brand_id into v_brand_id;

  for v_product in select value from jsonb_array_elements(p_products) loop
    v_product_name := btrim(coalesce(v_product->>'name', ''));
    if v_product_name = '' then
      raise exception 'Every product needs a name.';
    end if;
    if exists (select 1 from public.products where lower(btrim(name)) = lower(v_product_name)) then
      raise exception 'Product "%" already exists in the catalogue. Products must be unique to this brand.', v_product_name;
    end if;
    if coalesce(v_product->'variants', '[]'::jsonb) = '[]'::jsonb then
      raise exception 'Product "%" needs at least one variant.', v_product_name;
    end if;
    v_category_id := nullif(btrim(coalesce(v_product->>'category_id', '')), '')::uuid;
    if v_category_id is null or not exists (select 1 from public.categories where category_id = v_category_id) then
      raise exception 'Product "%": choose a valid category.', v_product_name;
    end if;

    select min((item.value->>'price')::numeric)
      into v_min_price
      from jsonb_array_elements(v_product->'variants') item;
    if v_min_price is null or v_min_price < 0 then
      raise exception 'Product "%": every variant needs a valid price.', v_product_name;
    end if;

    insert into public.products (brand_id, category_id, name, description, price, status)
    values (v_brand_id, v_category_id, v_product_name,
            nullif(btrim(coalesce(v_product->>'description', '')), ''), v_min_price, 'Active')
    returning product_id into v_product_id;

    for v_variant in select value from jsonb_array_elements(v_product->'variants') loop
      v_size := nullif(btrim(coalesce(v_variant->>'size', '')), '');
      if v_size is null then
        raise exception 'Product "%": each variant needs a size.', v_product_name;
      end if;
      v_price := (v_variant->>'price')::numeric;
      if v_price is null or v_price < 0 then
        raise exception 'Product "%": each variant needs a valid price.', v_product_name;
      end if;
      v_expiry := nullif(btrim(coalesce(v_variant->>'expiry_date', '')), '')::date;
      if v_expiry is null then
        raise exception 'Product "%": each variant needs an expiry date.', v_product_name;
      end if;
      if exists (
        select 1 from public.product_variants
        where product_id = v_product_id and lower(btrim(size)) = lower(v_size)
      ) then
        raise exception 'Product "%" already has that size.', v_product_name;
      end if;

      insert into public.product_variants (
        product_id, size, additional_price, supplier_price, sku, expiry_date
      ) values (
        v_product_id, v_size, v_price - v_min_price,
        round(v_price / 1.30, 2),
        'PGB-' || upper(substr(replace(v_product_id::text, '-', ''), 1, 6)) || '-' ||
          upper(substr(md5(v_size || '|' || random()::text), 1, 8)),
        v_expiry
      )
      returning variant_id into v_variant_id;

      insert into public.inventory (variant_id, stock_quantity, reorder_level)
      values (v_variant_id, greatest(coalesce((v_variant->>'stock')::integer, 0), 0), 10);
    end loop;
  end loop;

  return v_brand_id;
end;
$fn$;

-- Supplier onboarding: one atomic call creates the supplier and its first
-- brand, products, and variants.
create or replace function public.create_supplier_catalog(
  p_name text,
  p_contact_name text,
  p_contact_email text,
  p_phone text,
  p_address text,
  p_brand_name text,
  p_products jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_supplier_id uuid;
begin
  if not public.has_permission('suppliers', 'create') then
    raise exception 'You need supplier create access.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Supplier name is required.';
  end if;

  insert into public.suppliers (name, contact_name, contact_email, phone, address, status)
  values (btrim(p_name), btrim(coalesce(p_contact_name, '')), btrim(coalesce(p_contact_email, '')),
          btrim(coalesce(p_phone, '')), btrim(coalesce(p_address, '')), 'Active')
  returning supplier_id into v_supplier_id;

  perform public._create_brand_catalog(v_supplier_id, p_brand_name, p_products);
  return v_supplier_id;
end;
$fn$;

-- Adds another brand (and its products/variants) to an existing supplier.
create or replace function public.create_supplier_brand(
  p_supplier_id uuid,
  p_brand_name text,
  p_products jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_status text;
begin
  if not public.has_permission('suppliers', 'edit') then
    raise exception 'You need supplier edit access.';
  end if;
  select status into v_status from public.suppliers where supplier_id = p_supplier_id;
  if v_status is null then
    raise exception 'Supplier not found.';
  end if;
  if v_status = 'Archived' then
    raise exception 'Restore the supplier before adding a brand.';
  end if;
  return public._create_brand_catalog(p_supplier_id, p_brand_name, p_products);
end;
$fn$;

revoke all on function public._create_brand_catalog(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_supplier_catalog(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_supplier_catalog(text, text, text, text, text, text, jsonb) to authenticated;
revoke all on function public.create_supplier_brand(uuid, text, jsonb) from public, anon;
grant execute on function public.create_supplier_brand(uuid, text, jsonb) to authenticated;

-- 3. The junction table is no longer a source of truth.
drop table if exists public.supplier_products;

notify pgrst, 'reload schema';

commit;