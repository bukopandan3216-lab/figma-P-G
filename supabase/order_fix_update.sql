-- Update script for the checkout + admin numbering flow.
-- Run after schema.sql and before seed scripts if needed.
-- This keeps the base schema intact while applying the missing live DB backfills
-- required for sequence-based order numbers and real stock-movement linkage.

begin;

-- 1) Sequential document numbers for orders, purchase orders, and movements.
create sequence if not exists public.order_no_seq;
create sequence if not exists public.po_no_seq;
create sequence if not exists public.movement_no_seq;

alter table public.orders add column if not exists order_no text unique;
alter table public.purchase_orders add column if not exists po_no text unique;
alter table public.inventory_movements add column if not exists movement_no text unique;

create or replace function public.gen_order_no()
returns trigger language plpgsql as $$
begin
  if new.order_no is null then
    new.order_no := 'ORD-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public.gen_po_no()
returns trigger language plpgsql as $$
begin
  if new.po_no is null then
    new.po_no := 'PO-' || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(nextval('public.po_no_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public.gen_movement_no()
returns trigger language plpgsql as $$
begin
  if new.movement_no is null then
    new.movement_no := (case when new.movement_type = 'Stock In' then 'SI-' else 'SO-' end)
      || to_char(coalesce(new.created_at, now()), 'YYYY') || '-' || lpad(nextval('public.movement_no_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_no on public.orders;
create trigger trg_order_no before insert on public.orders for each row execute procedure public.gen_order_no();

drop trigger if exists trg_po_no on public.purchase_orders;
create trigger trg_po_no before insert on public.purchase_orders for each row execute procedure public.gen_po_no();

drop trigger if exists trg_movement_no on public.inventory_movements;
create trigger trg_movement_no before insert on public.inventory_movements for each row execute procedure public.gen_movement_no();

with numbered as (
  select id, created_at, row_number() over (order by created_at, id) as rn
  from public.orders where order_no is null
)
update public.orders o
set order_no = 'ORD-' || to_char(numbered.created_at, 'YYYY') || '-' || lpad(numbered.rn::text, 6, '0')
from numbered
where numbered.id = o.id;
select setval('public.order_no_seq', greatest((select count(*) from public.orders), 1));

with numbered as (
  select id, created_at, row_number() over (order by created_at, id) as rn
  from public.purchase_orders where po_no is null
)
update public.purchase_orders p
set po_no = 'PO-' || to_char(numbered.created_at, 'YYYY') || '-' || lpad(numbered.rn::text, 6, '0')
from numbered
where numbered.id = p.id;
select setval('public.po_no_seq', greatest((select count(*) from public.purchase_orders), 1));

with numbered as (
  select id, created_at, movement_type, row_number() over (order by created_at, id) as rn
  from public.inventory_movements where movement_no is null
)
update public.inventory_movements m
set movement_no = (case when numbered.movement_type = 'Stock In' then 'SI-' else 'SO-' end)
  || to_char(numbered.created_at, 'YYYY') || '-' || lpad(numbered.rn::text, 6, '0')
from numbered
where numbered.id = m.id;
select setval('public.movement_no_seq', greatest((select count(*) from public.inventory_movements), 1));

-- 2) Real relationship cleanup for purchase order items and stock movement traceability.
alter table public.purchase_order_items
  add column if not exists variant_id uuid references public.product_variants(id);

update public.purchase_order_items poi
set variant_id = (
  select v.id
  from public.product_variants v
  where v.product_id = poi.product_id
  order by v.sku
  limit 1
)
where poi.variant_id is null;

create index if not exists purchase_order_items_variant_id_idx on public.purchase_order_items(variant_id);

alter table public.inventory_movements
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete set null;

update public.inventory_movements m
set order_id = o.id
from public.orders o
where m.order_id is null and m.movement_type = 'Stock Out' and m.reference = o.id::text;

update public.inventory_movements m
set purchase_order_id = po.id
from public.purchase_orders po
where m.purchase_order_id is null and m.movement_type = 'Stock In' and m.reference = po.id::text;

create index if not exists inventory_movements_order_id_idx on public.inventory_movements(order_id);
create index if not exists inventory_movements_purchase_order_id_idx on public.inventory_movements(purchase_order_id);

-- 3) Ensure the order RPC writes the real FKs and validates stock.
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
begin
  if p_user_id <> auth.uid() then
    raise exception 'User mismatch';
  end if;

  insert into public.orders (
    user_id, total_amount, subtotal, shipping_fee, tax,
    payment_method, shipping_name, shipping_email, shipping_phone,
    shipping_address, shipping_city, shipping_zip, shipping_country
  )
  values (
    p_user_id, p_total_amount, p_subtotal, p_shipping_fee, p_tax,
    p_payment_method, p_shipping_name, p_shipping_email, p_shipping_phone,
    p_shipping_address, p_shipping_city, p_shipping_zip, p_shipping_country
  )
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_inventory
    from public.inventory
    where variant_id = (v_item ->> 'variant_id')::uuid
    for update;

    if v_inventory.stock_quantity < (v_item ->> 'quantity')::integer then
      raise exception 'Insufficient stock';
    end if;

    insert into public.order_items (order_id, variant_id, quantity, price_at_purchase)
    values (
      v_order.id,
      (v_item ->> 'variant_id')::uuid,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'price_at_purchase')::numeric
    );

    update public.inventory
    set stock_quantity = stock_quantity - (v_item ->> 'quantity')::integer,
        updated_at = now()
    where id = v_inventory.id;

    insert into public.inventory_movements (variant_id, movement_type, quantity, reference, order_id)
    values (
      (v_item ->> 'variant_id')::uuid,
      'Stock Out',
      (v_item ->> 'quantity')::integer,
      v_order.id::text,
      v_order.id
    );
  end loop;

  insert into public.payments (order_id, provider, status, amount)
  values (
    v_order.id,
    case when p_payment_method = 'cash_on_delivery' then 'Cash on Delivery' else 'Stripe' end,
    'Pending',
    p_total_amount
  );

  return v_order;
end;
$$;

-- Ensure row-level rules allow the app to write order-linked records.
drop policy if exists own_order_payment_insert on public.payments;
create policy own_order_payment_insert on public.payments for insert with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

drop policy if exists own_order_movement_insert on public.inventory_movements;
create policy own_order_movement_insert on public.inventory_movements for insert with check (
  auth.uid() is not null and order_id is not null and exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  )
);

drop policy if exists authenticated_inventory_update on public.inventory;
create policy authenticated_inventory_update on public.inventory for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists authenticated_inventory_insert on public.inventory;
create policy authenticated_inventory_insert on public.inventory for insert with check (auth.uid() is not null);

grant execute on function public.place_order(
  uuid,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

-- 4) Validation: these queries should return zero rows after the fix.
select 'orders_missing_order_no' as check_name, count(*) as row_count
from public.orders where order_no is null
union all
select 'purchase_orders_missing_po_no', count(*)
from public.purchase_orders where po_no is null
union all
select 'movements_missing_movement_no', count(*)
from public.inventory_movements where movement_no is null
union all
select 'purchase_order_items_missing_variant', count(*)
from public.purchase_order_items where variant_id is null
union all
select 'duplicate_order_nos', count(*)
from (
  select order_no from public.orders where order_no is not null group by order_no having count(*) > 1
) dup
union all
select 'duplicate_po_nos', count(*)
from (
  select po_no from public.purchase_orders where po_no is not null group by po_no having count(*) > 1
) dup
union all
select 'duplicate_movement_nos', count(*)
from (
  select movement_no from public.inventory_movements where movement_no is not null group by movement_no having count(*) > 1
) dup
union all
select 'stock_out_movements_missing_order_link', count(*)
from public.inventory_movements
where movement_type = 'Stock Out' and order_id is null
union all
select 'stock_in_movements_missing_purchase_link', count(*)
from public.inventory_movements
where movement_type = 'Stock In' and purchase_order_id is null
union all
select 'stock_out_movements_missing_variant', count(*)
from public.inventory_movements
where movement_type = 'Stock Out' and variant_id is null
union all
select 'stock_in_movements_missing_variant', count(*)
from public.inventory_movements
where movement_type = 'Stock In' and variant_id is null;

commit;
