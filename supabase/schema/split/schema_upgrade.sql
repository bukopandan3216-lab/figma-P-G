-- ============================================================================
-- schema_upgrade.sql â€” P&G Beauty web app (upgrade an existing database)
--
-- Use on a database that was built from the older migration chain. It applies
-- the guarded deltas only: legacy employee_rbac cleanup, entity-keyed id
-- renames, post-launch columns (documents, discounts, supplier link), variant
-- photos, per-variant expiry, the cart surrogate key, and the matching
-- indexes, RPCs and grants.
--
-- For an empty project use ../split/schema_fresh.sql instead. The canonical
-- ../idempotent/schema_complete.sql handles both cases.
--
-- Generated from the canonical file â€” update that file first, then here.
-- Safe to re-run: every statement is guarded.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================================
-- 0. Cleanup of superseded migrations (no-ops on a fresh project)
--    employee_rbac.sql introduced a department-based model that pdf_rbac.sql
--    reverted, but left behind dead functions and one broken audit trigger
--    that still writes to the dropped employee_audit_log table.
-- ============================================================================

-- Normalize legacy primary keys to entity-based ids (product_id, brand_id, ...).
-- No-op on a fresh project; required once on databases created with generic "id" keys.
do $$
declare
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    array['brands', 'id', 'brand_id'],
    array['categories', 'id', 'category_id'],
    array['products', 'id', 'product_id'],
    array['product_variants', 'id', 'variant_id'],
    array['profiles', 'id', 'user_id'],
    array['suppliers', 'id', 'supplier_id'],
    array['purchase_orders', 'id', 'purchase_order_id'],
    array['purchase_order_items', 'id', 'purchase_order_item_id'],
    array['orders', 'id', 'order_id'],
    array['order_items', 'id', 'order_item_id'],
    array['recommendation_rules', 'id', 'rule_id'],
    array['recommendations', 'id', 'recommendation_id'],
    array['customer_product_interactions', 'id', 'interaction_id'],
    array['user_activity_log', 'id', 'activity_id'],
    array['payments', 'id', 'payment_id'],
    array['inventory', 'id', 'inventory_id'],
    array['inventory_movements', 'id', 'movement_id'],
    array['user_addresses', 'id', 'address_id'],
    array['user_payment_methods', 'id', 'payment_method_id'],
    array['support_inquiries', 'id', 'inquiry_id'],
    array['support_responses', 'id', 'response_id'],
    array['product_reviews', 'id', 'review_id']
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_pair[1] and column_name = v_pair[2]
    ) and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_pair[1] and column_name = v_pair[3]
    ) then
      execute format('alter table public.%I rename column %I to %I', v_pair[1], v_pair[2], v_pair[3]);
    end if;
  end loop;
end;
$$;

drop function if exists public.audit_employee_activity() cascade;
drop function if exists public.assign_employee_id() cascade;
drop function if exists public.initialize_department_inventory() cascade;
drop function if exists public.can_access_department(text) cascade;
drop function if exists public.transfer_central_inventory(uuid, text, integer) cascade;
drop function if exists public.is_active_user() cascade;
drop function if exists public.is_active_customer() cascade;

-- Column-level patches for databases created before an entity-keyed schema are
-- applied after the tables exist (section 1b below).

drop index if exists public.inventory_variant_department_idx;
drop index if exists public.orders_department_created_at_idx;
drop index if exists public.inventory_movements_department_idx;
drop table if exists public.department_city_mappings;
drop table if exists public.departments;
drop table if exists public.employee_audit_log;
drop sequence if exists public.employee_id_seq;

-- ============================================================================
-- 1b. Upgrades for databases created by the older migration chain
--     (guarded; every statement is a no-op on a fresh project)
-- ============================================================================

-- Remove the superseded employee_rbac triggers/columns now that the tables
-- exist (this block used to run before section 1 and could not work on an
-- empty project).
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'brands', 'categories', 'products', 'product_variants',
    'inventory', 'inventory_movements', 'suppliers',
    'purchase_orders', 'purchase_order_items', 'orders', 'order_items',
    'payments', 'recommendations', 'customer_product_interactions',
    'support_inquiries', 'support_responses', 'user_activity_log',
    'recommendation_rules'
  ] loop
    execute format('drop trigger if exists audit_employee_activity on public.%I', v_table);
    execute format('drop trigger if exists assign_employee_id on public.%I', v_table);
    execute format('drop trigger if exists initialize_department_inventory on public.%I', v_table);
  end loop;
end;
$$;

alter table public.profiles drop column if exists full_name;
alter table public.profiles drop column if exists employee_id;
alter table public.profiles drop column if exists position;
alter table public.profiles drop column if exists department;
alter table public.profiles drop column if exists module_permissions;
alter table public.inventory drop column if exists department;
alter table public.orders drop column if exists department;
alter table public.inventory_movements drop column if exists department;

-- Columns added after the original schema (no-ops on a fresh project).
alter table public.profiles add column if not exists document_number text;
alter table public.inventory_movements add column if not exists stock_after integer not null default 0 check (stock_after >= 0);
alter table public.inventory_movements add column if not exists user_document text;
alter table public.products add column if not exists sale_price numeric;
alter table public.products add column if not exists discount_type text check (discount_type in ('percentage', 'fixed'));
alter table public.products add column if not exists discount_value numeric;
alter table public.products add column if not exists discount_start timestamptz;
alter table public.products add column if not exists discount_end timestamptz;
alter table public.brands add column if not exists supplier_id uuid references public.suppliers(supplier_id);
alter table public.brands alter column supplier_id set not null;
alter table public.products alter column brand_id set not null;
alter table public.product_variants alter column size set not null;
alter table public.product_variants drop column if exists scent;

-- Per-variant photos (variant_images.sql folded in here).
alter table public.product_variants add column if not exists images text[] not null default '{}';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_variants'::regclass
      and conname = 'product_variants_images_max_check'
  ) then
    alter table public.product_variants
      add constraint product_variants_images_max_check
      check (cardinality(images) <= 5);
  end if;
end;
$$;

-- Per-variant expiry (variant_expiry.sql folded in here).
alter table public.product_variants add column if not exists expiry_date date;

-- cart_items identity: a surrogate cart_item_id is required because a cart may
-- hold two variants of one product, making (user_id, product_id) non-unique.
alter table public.cart_items add column if not exists cart_item_id uuid default gen_random_uuid();
update public.cart_items set cart_item_id = gen_random_uuid() where cart_item_id is null;
alter table public.cart_items alter column cart_item_id set not null;

-- Collapse duplicate legacy rows before enforcing one row per SKU.
delete from public.cart_items a
using public.cart_items b
where a.cart_item_id > b.cart_item_id
  and a.user_id = b.user_id
  and a.product_id = b.product_id
  and coalesce(a.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(b.variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

do $$
declare
  v_pk text;
  v_pk_uses_cart_item_id boolean;
begin
  select conname into v_pk
  from pg_constraint
  where conrelid = 'public.cart_items'::regclass and contype = 'p';

  if v_pk is not null then
    select exists (
      select 1
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = 'public.cart_items'::regclass
        and c.contype = 'p'
        and a.attname = 'cart_item_id'
    ) into v_pk_uses_cart_item_id;

    if not v_pk_uses_cart_item_id then
      execute format('alter table public.cart_items drop constraint %I', v_pk);
    end if;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cart_items'::regclass and contype = 'p'
  ) then
    alter table public.cart_items add constraint cart_items_pkey primary key (cart_item_id);
  end if;
end;
$$;

drop index if exists public.inventory_variant_department_idx;
drop index if exists public.orders_department_created_at_idx;
drop index if exists public.inventory_movements_department_idx;
drop table if exists public.department_city_mappings;
drop table if exists public.departments;
drop table if exists public.employee_audit_log;
drop sequence if exists public.employee_id_seq;

-- ============================================================================
-- Indexes required by the folded-in migrations
-- ============================================================================

create index if not exists product_variants_expiry_date_idx on public.product_variants(expiry_date);
-- Supplier -> brand -> product -> size variant uniqueness (one product name in
-- the whole catalogue; one size per product).
drop index if exists public.product_variants_combo_unique_idx;
create unique index if not exists brands_name_unique_idx on public.brands (lower(btrim(name)));
create unique index if not exists products_name_unique_idx on public.products (lower(btrim(name)));
create unique index if not exists product_variants_size_unique_idx
  on public.product_variants (product_id, lower(btrim(size)));
create unique index if not exists cart_items_user_product_variant_key
  on public.cart_items (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================================
-- Document number sequences
-- ============================================================================

create sequence if not exists public.order_no_seq;
create sequence if not exists public.po_no_seq;
create sequence if not exists public.movement_no_seq;
create sequence if not exists public.document_no_seq;

-- Bring every sequence up to at least the highest number already stored (never
-- move it backwards). Older seeds inserted explicit document numbers without
-- advancing the sequences, so the next insert collided.
do $$
declare
  v_target record;
begin
  for v_target in
    select * from (values
      ('public.order_no_seq', 'select coalesce(max((regexp_match(order_no, ''-([0-9]+)$''))[1]::bigint), 0) from public.orders where order_no like ''ORD-%'''),
      ('public.po_no_seq', 'select coalesce(max((regexp_match(po_no, ''-([0-9]+)$''))[1]::bigint), 0) from public.purchase_orders where po_no like ''PO-%'''),
      ('public.movement_no_seq', 'select coalesce(max((regexp_match(movement_no, ''-([0-9]+)$''))[1]::bigint), 0) from public.inventory_movements where movement_no ~ ''^(SI|SO)-'''),
      ('public.document_no_seq', 'select coalesce(max((regexp_match(document_number, ''^DOC-([0-9]+)$''))[1]::bigint), 0) from public.profiles where document_number like ''DOC-%''')
    ) as targets(sequence_name, max_sql)
  loop
    execute format(
      'select setval(%L, greatest((%s), (select last_value from %s), 1))',
      v_target.sequence_name, v_target.max_sql, v_target.sequence_name
    );
  end loop;
end;
$$;

-- Checkout: atomic order + stock decrement + movement + pending payment.
create or replace function public.place_order(
  p_user_id uuid,
  p_items jsonb,
  p_total_amount numeric,
  p_subtotal numeric,
  p_shipping_fee numeric,
  p_tax numeric,
  p_payment_method text,
  p_shipping_name text,
  p_shipping_email text,
  p_shipping_phone text,
  p_shipping_address text,
  p_shipping_city text,
  p_shipping_zip text,
  p_shipping_country text default 'Philippines'
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_inventory public.inventory;
  v_variant_id uuid;
  v_quantity integer;
  v_product_id uuid;
  v_recommendation_id uuid;
  v_user_document text;
  v_expiry date;
begin
  if p_user_id <> auth.uid() or not public.is_customer() then
    raise exception 'Customer access required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required';
  end if;

  insert into public.orders (user_id, total_amount, subtotal, shipping_fee, tax, payment_method, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, shipping_zip, shipping_country)
  values (p_user_id, p_total_amount, p_subtotal, p_shipping_fee, p_tax, p_payment_method, p_shipping_name, p_shipping_email, p_shipping_phone, p_shipping_address, p_shipping_city, p_shipping_zip, p_shipping_country)
  returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_variant_id := (v_item ->> 'variant_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_variant_id is null or v_quantity is null or v_quantity <= 0 then
      raise exception 'Order item variant and positive quantity are required';
    end if;
    select * into v_inventory from public.inventory where variant_id = v_variant_id for update;
    if not found then raise exception 'Inventory row not found'; end if;
    if v_inventory.stock_quantity < v_quantity then raise exception 'Insufficient stock'; end if;

    -- Expired or within the 60-day near-expiry window: never sellable.
    select expiry_date into v_expiry from public.product_variants where variant_id = v_variant_id;
    if v_expiry is not null and v_expiry <= current_date + 60 then
      raise exception 'One or more items are expired or near expiry and cannot be purchased';
    end if;

    insert into public.order_items (order_id, variant_id, quantity, price_at_purchase)
    values (v_order.order_id, v_variant_id, v_quantity, (v_item ->> 'price_at_purchase')::numeric);
    update public.inventory set stock_quantity = stock_quantity - v_quantity, updated_at = now() where inventory_id = v_inventory.inventory_id;
    select document_number into v_user_document from public.profiles where user_id = p_user_id;
    insert into public.inventory_movements (variant_id, movement_type, quantity, stock_after, user_document, reference, order_id)
    values (v_variant_id, 'Stock Out', v_quantity, v_inventory.stock_quantity - v_quantity, v_user_document, v_order.order_id::text, v_order.order_id);

    select product_id into v_product_id from public.product_variants where variant_id = v_variant_id;
    select recommendation_id into v_recommendation_id
    from public.customer_product_interactions
    where user_id = p_user_id and product_id = v_product_id
      and interaction_type = 'recommendation_clicked'
    order by created_at desc limit 1;
    insert into public.customer_product_interactions (user_id, product_id, recommendation_id, interaction_type)
    values (p_user_id, v_product_id, v_recommendation_id, 'purchase');
  end loop;

  insert into public.payments (order_id, provider, status, amount)
  values (v_order.order_id, case when p_payment_method = 'cash_on_delivery' then 'Cash on Delivery' else 'Stripe' end, 'Pending', p_total_amount);

  -- The order is in: every cart line has now been checked out.
  delete from public.cart_items where user_id = p_user_id;

  return v_order;
end;
$$;

-- ============================================================================
-- Grants and RPCs
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- The new product_variants columns (images, expiry_date) must be readable; the
-- grant is column-level because supplier_price is deliberately excluded.
revoke select on public.product_variants from anon, authenticated;
grant select (variant_id, product_id, size, additional_price, sku, images, expiry_date)
  on public.product_variants to anon, authenticated;

-- Checkout runs only through the place_order RPC.
revoke insert on public.orders, public.order_items, public.payments, public.inventory_movements from authenticated;

grant execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) to authenticated;
revoke execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) from public, anon;

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
  v_tags text[];
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

    select coalesce(array_agg(distinct normalized.tag), '{}'::text[])
      into v_tags
      from (
        select lower(regexp_replace(btrim(tag_item #>> '{}'), '\s+', ' ', 'g')) as tag
        from jsonb_array_elements(
          case when jsonb_typeof(v_product->'tags') = 'array' then v_product->'tags' else '[]'::jsonb end
        ) as tag_item
        where jsonb_typeof(tag_item) = 'string'
      ) normalized
      where normalized.tag <> '';

    insert into public.products (brand_id, category_id, name, description, price, tags, status)
    values (v_brand_id, v_category_id, v_product_name,
            nullif(btrim(coalesce(v_product->>'description', '')), ''), v_min_price, v_tags, 'Active')
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
drop table if exists public.supplier_products;


-- Dynamic storefront search suggestions. Frequent products are per-customer,
-- with a global fallback for guests or customers without interaction history.
create or replace function public.get_search_suggestions(p_limit integer default 5)
returns table (
  section text,
  product_id uuid,
  name text,
  brand_name text,
  image text,
  tags text[],
  score bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_user uuid := auth.uid();
  v_has_history boolean := false;
begin
  if v_user is not null then
    select exists (
      select 1
      from public.customer_product_interactions
      where user_id = v_user
    ) into v_has_history;
  end if;

  if v_has_history then
    return query
    select
      'frequent'::text,
      p.product_id,
      p.name,
      b.name,
      coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
      p.tags,
      count(*)::bigint
    from public.customer_product_interactions interaction
    join public.products p on p.product_id = interaction.product_id
    join public.brands b on b.brand_id = p.brand_id
    where interaction.user_id = v_user
      and p.status = 'Active'
      and exists (
        select 1
        from public.product_variants variant
        where variant.product_id = p.product_id
          and (variant.expiry_date is null or variant.expiry_date > current_date + 60)
      )
    group by p.product_id, p.name, b.name, p.image, p.images
    order by count(*) desc, p.name
    limit v_limit;
  else
    return query
    select
      'frequent'::text,
      p.product_id,
      p.name,
      b.name,
      coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
      p.tags,
      count(*)::bigint
    from public.customer_product_interactions interaction
    join public.products p on p.product_id = interaction.product_id
    join public.brands b on b.brand_id = p.brand_id
    where p.status = 'Active'
      and exists (
        select 1
        from public.product_variants variant
        where variant.product_id = p.product_id
          and (variant.expiry_date is null or variant.expiry_date > current_date + 60)
      )
    group by p.product_id, p.name, b.name, p.image, p.images, p.tags
    order by count(*) desc, p.name
    limit v_limit;
  end if;

  return query
  select
    'top_selling'::text,
    p.product_id,
    p.name,
    b.name,
    coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
    p.tags,
    sum(item.quantity)::bigint
  from public.order_items item
  join public.orders o on o.order_id = item.order_id
  join public.product_variants variant on variant.variant_id = item.variant_id
  join public.products p on p.product_id = variant.product_id
  join public.brands b on b.brand_id = p.brand_id
  where o.status <> 'Cancelled'
    and p.status = 'Active'
    and exists (
      select 1
      from public.product_variants sellable
      where sellable.product_id = p.product_id
        and (sellable.expiry_date is null or sellable.expiry_date > current_date + 60)
    )
  group by p.product_id, p.name, b.name, p.image, p.images
  order by sum(item.quantity) desc, p.name
  limit v_limit;
end;
$fn$;

revoke all on function public.get_search_suggestions(integer) from public;
grant execute on function public.get_search_suggestions(integer) to anon, authenticated;

-- Reviewer display names are product-scoped and served by a hardened RPC;
-- the old security-definer view is removed.
drop view if exists public.review_authors;
create or replace function public.get_product_review_authors(p_product_id uuid)
returns table (user_id uuid, first_name text, last_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct profile.user_id, profile.first_name, profile.last_name
  from public.product_reviews review
  join public.profiles profile on profile.user_id = review.user_id
  join public.products product on product.product_id = review.product_id
  where review.product_id = p_product_id
    and product.status = 'Active';
$fn$;

revoke all on function public.get_product_review_authors(uuid) from public;
grant execute on function public.get_product_review_authors(uuid) to anon, authenticated;

commit;
