-- Additive, repeatable demo data for the analytics dashboard (1,500 orders).
--
-- Run AFTER supabase/seeds/seed.sql. Customers live in Auth-backed profiles, so
-- this file never creates or modifies Auth accounts: it reuses existing customer
-- profiles, falling back to staff/admin profiles only when there are no
-- customers. Every insert is guarded, so it is safe to re-run.

begin;

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where role in ('customer', 'super_admin', 'beauty_admin', 'beauty_staff')
  ) then
    raise exception 'Demo analytics seed requires at least one customer or staff profile.';
  end if;

  if not exists (
    select 1
    from public.products p
    join public.product_variants v on v.product_id = p.product_id
    where p.status = 'Active'
  ) then
    raise exception 'Demo analytics seed requires active products with variants.';
  end if;
end;
$$;

create temporary table demo_analytics_rows on commit drop as
with profile_candidates as (
  select user_id, first_name, last_name, email
  from public.profiles
  where role = 'customer'

  union all

  select user_id, first_name, last_name, email
  from public.profiles
  where role in ('super_admin', 'beauty_admin', 'beauty_staff')
    and not exists (select 1 from public.profiles where role = 'customer')
),
numbered_profiles as (
  select
    user_id,
    first_name,
    last_name,
    email,
    row_number() over (order by user_id) as row_num,
    count(*) over () as row_count
  from profile_candidates
),
numbered_variants as (
  select
    p.product_id,
    v.variant_id,
    p.price + v.additional_price as unit_price,
    row_number() over (order by p.product_id, v.sku) as row_num,
    count(*) over () as row_count
  from public.products p
  join public.product_variants v on v.product_id = p.product_id
  where p.status = 'Active'
),
sequence as (
  select
    n,
    ((n - 1) % profiles.row_count) + 1 as profile_row,
    ((n * 37) % variants.row_count) + 1 as variant_row
  from generate_series(1, 1500) as generated(n)
  cross join (select max(row_count) as row_count from numbered_profiles) profiles
  cross join (select max(row_count) as row_count from numbered_variants) variants
)
select
  'DEMO-ANALYTICS-' || lpad(sequence.n::text, 6, '0') as order_no,
  profiles.user_id,
  variants.product_id,
  variants.variant_id,
  variants.unit_price,
  1 + sequence.n % 3 as quantity,
  variants.unit_price * (1 + sequence.n % 3) as subtotal,
  case when sequence.n % 4 = 0 then 0::numeric else 50::numeric end as shipping_fee,
  round((variants.unit_price * (1 + sequence.n % 3) * 0.12)::numeric, 2) as tax,
  case
    when sequence.n % 20 = 0 then 'Cancelled'
    when sequence.n % 5 = 0 then 'Pending'
    when sequence.n % 5 = 1 then 'Processing'
    when sequence.n % 5 = 2 then 'Shipped'
    else 'Delivered'
  end as status,
  case
    when sequence.n % 20 = 0 then 'Refunded'
    when sequence.n % 5 in (0, 1) then 'Unpaid'
    else 'Paid'
  end as payment_status,
  case sequence.n % 3
    when 0 then 'card'
    when 1 then 'cash_on_delivery'
    else 'gcash'
  end as payment_method,
  concat_ws(' ', nullif(profiles.first_name, ''), nullif(profiles.last_name, '')) as shipping_name,
  coalesce(profiles.email, '') as shipping_email,
  (sequence.n % 999 + 1)::text || ' Demo Street, Barangay ' || (sequence.n % 80 + 1)::text as shipping_address,
  case sequence.n % 5
    when 0 then 'Makati City'
    when 1 then 'Quezon City'
    when 2 then 'Cebu City'
    when 3 then 'Davao City'
    else 'Pasig City'
  end as shipping_city,
  lpad((1000 + sequence.n % 8999)::text, 4, '0') as shipping_zip,
  now() - make_interval(
    days => (sequence.n * 17) % 365,
    hours => (sequence.n * 13) % 24,
    mins => (sequence.n * 29) % 60
  ) as created_at
from sequence
join numbered_profiles profiles on profiles.row_num = sequence.profile_row
join numbered_variants variants on variants.row_num = sequence.variant_row;

insert into public.orders (
  user_id, total_amount, subtotal, shipping_fee, tax, status, payment_status,
  payment_method, shipping_name, shipping_email, shipping_address, shipping_city,
  shipping_zip, shipping_country, created_at, order_no
)
select
  user_id,
  subtotal + shipping_fee + tax,
  subtotal,
  shipping_fee,
  tax,
  status,
  payment_status,
  payment_method,
  shipping_name,
  shipping_email,
  shipping_address,
  shipping_city,
  shipping_zip,
  'Philippines',
  created_at,
  order_no
from demo_analytics_rows
on conflict (order_no) do nothing;

insert into public.order_items (order_id, variant_id, quantity, price_at_purchase)
select orders.order_id, seed.variant_id, seed.quantity, seed.unit_price
from demo_analytics_rows seed
join public.orders orders on orders.order_no = seed.order_no
where not exists (
  select 1 from public.order_items items where items.order_id = orders.order_id
);

insert into public.payments (order_id, provider, status, amount)
select orders.order_id, 'Dashboard demo seed', seed.payment_status, orders.total_amount
from demo_analytics_rows seed
join public.orders orders on orders.order_no = seed.order_no
where not exists (
  select 1
  from public.payments payments
  where payments.order_id = orders.order_id
    and payments.provider = 'Dashboard demo seed'
);

commit;
