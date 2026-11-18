begin;

-- ============================================================================
-- Purchase management: supplier status/PO columns, the hidden supplier cost
-- column, and the variant-level create_purchase_order RPC.
--
-- This file is idempotent: running it on an up-to-date database only refreshes
-- the pieces below. Column names use the canonical *_id form (supplier_id,
-- product_id, purchase_order_id).
-- ============================================================================

alter table public.suppliers
  add column if not exists contact_name text not null default '',
  add column if not exists status text not null default 'Active';
alter table public.suppliers drop constraint if exists suppliers_status_check;
alter table public.suppliers add constraint suppliers_status_check
  check (status in ('Active', 'Inactive', 'Archived'));

alter table public.purchase_orders
  add column if not exists expected_delivery date,
  add column if not exists payment_terms text not null default '',
  add column if not exists notes text not null default '';

-- ─── Hidden supplier cost (30% markup, single source in the app) ─────────────
-- The markup is defined ONCE, SUPPLIER_MARKUP_PERCENT in src/lib/catalog.ts:
--     supplier_price = round(full listing / 1.30, 2)
-- where full listing = coalesce(products.original_price, products.price)
--                      + product_variants.additional_price
-- Shop prices are never touched; only the cost a purchase order books changes.
alter table public.product_variants
  add column if not exists supplier_price numeric not null default 0.00;

update public.product_variants pv
set supplier_price = round((coalesce(p.original_price, p.price) + pv.additional_price) / 1.30, 2)
from public.products p
where p.product_id = pv.product_id;

alter table public.product_variants drop constraint if exists product_variants_supplier_price_check;
alter table public.product_variants add constraint product_variants_supplier_price_check
  check (supplier_price >= 0);

-- ─── create_purchase_order: one line per variant ─────────────────────────────
-- Items are [{product_id, variant_id, quantity}]. The product must belong to
-- the variant, the product must belong to a brand owned by the supplier, and
-- unit_cost is read server-side from product_variants.supplier_price — the
-- browser never sends a cost.
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

revoke all on function public.create_purchase_order(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, date, text, text, jsonb) to authenticated;

-- ─── Reading the hidden cost: get_variant_supplier_costs(variant_ids) ─────────
-- The column itself is revoked from anon/authenticated (see schema_complete.sql
-- grants), so the Purchases page fetches costs through this RPC, gated by
-- purchases/view: guests and customers are refused, admins get the grand total.
create or replace function public.get_variant_supplier_costs(p_variant_ids uuid[])
returns table(variant_id uuid, unit_cost numeric)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('purchases', 'view') then
    raise exception using errcode = '42501', message = 'Purchase order management access required';
  end if;
  return query
    select pv.variant_id, pv.supplier_price
    from public.product_variants pv
    where pv.variant_id = any (coalesce(p_variant_ids, '{}'::uuid[]));
end;
$$;

revoke select on public.product_variants from anon, authenticated;
grant select (variant_id, product_id, size, additional_price, sku, images, expiry_date)
  on public.product_variants to anon, authenticated;

revoke all on function public.get_variant_supplier_costs(uuid[]) from public, anon;
grant execute on function public.get_variant_supplier_costs(uuid[]) to authenticated;

commit;
