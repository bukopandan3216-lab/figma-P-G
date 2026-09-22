-- P&G Beauty IMS initial Supabase migration
-- Run once in the Supabase SQL editor against an empty project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'Customer' check (role in ('Customer', 'Beauty Staff', 'Beauty Admin', 'Super Admin')),
  skin_profile jsonb not null default '{}'::jsonb,
  email text,
  phone text,
  birthday date,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  image text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(id),
  category_id uuid references public.categories(id),
  name text not null,
  description text,
  price numeric(10, 2) not null check (price >= 0),
  original_price numeric(10, 2),
  image text,
  images text[] not null default '{}',
  tags text[] not null default '{}',
  rating numeric(3, 2) not null default 0,
  reviews integer not null default 0,
  badge text,
  status text not null default 'Draft' check (status in ('Active', 'Draft', 'Archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text,
  scent text,
  additional_price numeric(10, 2) not null default 0.00,
  sku text unique not null
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null unique references public.product_variants(id) on delete cascade,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  reorder_level integer not null default 10 check (reorder_level >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  phone text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (supplier_id, product_id)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id),
  supplier_id uuid references public.suppliers(id),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Shipped', 'Received', 'Cancelled')),
  total_cost numeric(10, 2) not null default 0 check (total_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric(10, 2) not null check (unit_cost >= 0)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  total_amount numeric(10, 2) not null check (total_amount >= 0),
  subtotal numeric(10, 2) not null default 0,
  shipping_fee numeric(10, 2) not null default 0,
  tax numeric(10, 2) not null default 0,
  status text not null default 'Pending' check (status in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
  payment_status text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Paid', 'Refunded')),
  stripe_payment_intent_id text,
  payment_method text not null default 'card',
  shipping_name text not null default '',
  shipping_email text not null default '',
  shipping_phone text,
  shipping_address text not null default '',
  shipping_city text not null default '',
  shipping_zip text not null default '',
  shipping_country text not null default 'Philippines',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  price_at_purchase numeric(10, 2) not null check (price_at_purchase >= 0)
);

create table if not exists public.recommendation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null,
  trigger_skin_type text[] not null default '{}',
  target_category_id uuid references public.categories(id),
  weight_modifier numeric(3, 2) not null default 1.00,
  is_active boolean not null default true
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null,
  provider_reference text,
  status text not null default 'Pending',
  amount numeric(10, 2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  movement_type text not null check (movement_type in ('Stock In', 'Stock Out')),
  quantity integer not null check (quantity > 0),
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  variant_id uuid references public.product_variants(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists products_brand_id_idx on public.products(brand_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists product_variants_product_id_idx on public.product_variants(product_id);
create index if not exists inventory_variant_id_idx on public.inventory(variant_id);
create index if not exists supplier_products_product_id_idx on public.supplier_products(product_id);
create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_order_items_product_id_idx on public.purchase_order_items(product_id);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_variant_id_idx on public.order_items(variant_id);
create index if not exists inventory_movements_variant_id_idx on public.inventory_movements(variant_id);
create index if not exists recommendation_rules_category_idx on public.recommendation_rules(target_category_id);
create index if not exists purchase_orders_created_by_idx on public.purchase_orders(created_by);
create index if not exists cart_items_product_id_idx on public.cart_items(product_id);
create index if not exists wishlist_items_product_id_idx on public.wishlist_items(product_id);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('Super Admin', 'Beauty Admin', 'Beauty Staff'));
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, skin_profile)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email, coalesce(new.raw_user_meta_data -> 'skin_profile', '{}'::jsonb))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

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
  if p_user_id <> auth.uid() then raise exception 'User mismatch'; end if;
  insert into public.orders (user_id, total_amount, subtotal, shipping_fee, tax, payment_method, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, shipping_zip, shipping_country)
  values (p_user_id, p_total_amount, p_subtotal, p_shipping_fee, p_tax, p_payment_method, p_shipping_name, p_shipping_email, p_shipping_phone, p_shipping_address, p_shipping_city, p_shipping_zip, p_shipping_country)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_inventory from public.inventory where variant_id = (v_item ->> 'variant_id')::uuid for update;
    if v_inventory.stock_quantity < (v_item ->> 'quantity')::integer then raise exception 'Insufficient stock'; end if;
    insert into public.order_items (order_id, variant_id, quantity, price_at_purchase)
    values (v_order.id, (v_item ->> 'variant_id')::uuid, (v_item ->> 'quantity')::integer, (v_item ->> 'price_at_purchase')::numeric);
    update public.inventory set stock_quantity = stock_quantity - (v_item ->> 'quantity')::integer, updated_at = now() where id = v_inventory.id;
    insert into public.inventory_movements (variant_id, movement_type, quantity, reference) values ((v_item ->> 'variant_id')::uuid, 'Stock Out', (v_item ->> 'quantity')::integer, v_order.id::text);
  end loop;
  insert into public.payments (order_id, provider, status, amount) values (v_order.id, case when p_payment_method = 'cash_on_delivery' then 'Cash on Delivery' else 'Stripe' end, 'Pending', p_total_amount);
  return v_order;
end;
$$;

create or replace view public.product_sales with (security_invoker = true) as
select p.id, p.name, p.category_id,
       coalesce(sum(case when o.status <> 'Cancelled' then oi.quantity else 0 end), 0)::integer as units_sold,
       coalesce(sum(case when o.status <> 'Cancelled' then oi.quantity * oi.price_at_purchase else 0 end), 0) as revenue,
       coalesce(sum(i.stock_quantity), 0)::integer as stock,
       coalesce(min(i.reorder_level), 10)::integer as reorder_level
from public.products p
left join public.product_variants v on v.product_id = p.id
left join public.order_items oi on oi.variant_id = v.id
left join public.orders o on o.id = oi.order_id
left join public.inventory i on i.variant_id = v.id
group by p.id, p.name, p.category_id;

create or replace view public.sales_by_month with (security_invoker = true) as
select date_trunc('month', o.created_at) as month_date,
       to_char(date_trunc('month', o.created_at), 'Mon YYYY') as month,
       coalesce(sum(o.total_amount), 0) as sales,
       count(*)::integer as orders
from public.orders o
where o.status <> 'Cancelled'
group by 1
order by 1;

create or replace view public.underperforming_products with (security_invoker = true) as
select p.id, p.name, p.created_at
from public.products p
where p.created_at < now() - interval '30 days'
and not exists (
  select 1 from public.order_items oi
  join public.product_variants v on v.id = oi.variant_id
  join public.orders o on o.id = oi.order_id
  where v.product_id = p.id and o.created_at >= now() - interval '30 days' and o.status <> 'Cancelled'
);

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.recommendation_rules enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlist_items enable row level security;

drop policy if exists profiles_self_or_admin on public.profiles;
drop policy if exists public_active_products on public.products;
drop policy if exists public_active_variants on public.product_variants;
drop policy if exists public_brands on public.brands;
drop policy if exists public_categories on public.categories;
drop policy if exists public_inventory on public.inventory;
drop policy if exists admin_brands on public.brands;
drop policy if exists admin_categories on public.categories;
drop policy if exists admin_products on public.products;
drop policy if exists admin_variants on public.product_variants;
drop policy if exists admin_inventory on public.inventory;
drop policy if exists admin_suppliers on public.suppliers;
drop policy if exists admin_supplier_products on public.supplier_products;
drop policy if exists admin_purchase_orders on public.purchase_orders;
drop policy if exists admin_purchase_items on public.purchase_order_items;
drop policy if exists own_orders_or_admin on public.orders;
drop policy if exists create_own_orders on public.orders;
drop policy if exists own_order_items_or_admin on public.order_items;
drop policy if exists create_own_order_items on public.order_items;
drop policy if exists recommendation_read on public.recommendation_rules;
drop policy if exists recommendation_admin on public.recommendation_rules;
drop policy if exists admin_payments on public.payments;
drop policy if exists own_payments on public.payments;
drop policy if exists own_order_payment_insert on public.payments;
drop policy if exists admin_movements on public.inventory_movements;
drop policy if exists own_order_movement_insert on public.inventory_movements;
drop policy if exists authenticated_inventory_update on public.inventory;
drop policy if exists authenticated_inventory_insert on public.inventory;
drop policy if exists own_cart_items on public.cart_items;
drop policy if exists own_wishlist_items on public.wishlist_items;

create policy profiles_self_or_admin on public.profiles for all using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy public_active_products on public.products for select using (status = 'Active' or public.is_admin());
create policy public_active_variants on public.product_variants for select using (exists (select 1 from public.products p where p.id = product_id and (p.status = 'Active' or public.is_admin())));
create policy public_brands on public.brands for select using (true);
create policy public_categories on public.categories for select using (true);
create policy public_inventory on public.inventory for select using (true);
create policy admin_brands on public.brands for all using (public.is_admin()) with check (public.is_admin());
create policy admin_categories on public.categories for all using (public.is_admin()) with check (public.is_admin());
create policy admin_products on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy admin_variants on public.product_variants for all using (public.is_admin()) with check (public.is_admin());
create policy admin_inventory on public.inventory for all using (public.is_admin()) with check (public.is_admin());
create policy admin_suppliers on public.suppliers for all using (public.is_admin()) with check (public.is_admin());
create policy admin_supplier_products on public.supplier_products for all using (public.is_admin()) with check (public.is_admin());
create policy admin_purchase_orders on public.purchase_orders for all using (public.is_admin()) with check (public.is_admin());
create policy admin_purchase_items on public.purchase_order_items for all using (public.is_admin()) with check (public.is_admin());
create policy own_orders_or_admin on public.orders for select using (user_id = auth.uid() or public.is_admin());
create policy create_own_orders on public.orders for insert with check (user_id = auth.uid());
create policy own_order_items_or_admin on public.order_items for select using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy create_own_order_items on public.order_items for insert with check (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy recommendation_read on public.recommendation_rules for select using (is_active or public.is_admin());
create policy recommendation_admin on public.recommendation_rules for all using (public.is_admin()) with check (public.is_admin());
create policy admin_payments on public.payments for all using (public.is_admin()) with check (public.is_admin());
create policy own_payments on public.payments for select using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy own_order_payment_insert on public.payments for insert with check (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);
create policy admin_movements on public.inventory_movements for all using (public.is_admin()) with check (public.is_admin());
create policy own_order_movement_insert on public.inventory_movements for insert with check (
  auth.uid() is not null and reference is not null and exists (
    select 1 from public.orders o
    where o.id::text = reference and o.user_id = auth.uid()
  )
);
create policy authenticated_inventory_update on public.inventory for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy authenticated_inventory_insert on public.inventory for insert with check (auth.uid() is not null);
create policy own_cart_items on public.cart_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_wishlist_items on public.wishlist_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.support_inquiries (
  id bigint generated by default as identity primary key,
  customer_name text not null default 'Customer',
  email text not null,
  subject text not null default 'Support Request',
  message text not null,
  status text not null default 'Open' check (status in ('Open', 'Pending', 'Resolved')),
  channel text not null default 'Chat',
  sentiment text not null default 'Needs review',
  support_reply text default '',
  last_reply text default 'Just now',
  created_at timestamptz not null default now()
);

create table if not exists public.support_responses (
  id bigint generated by default as identity primary key,
  inquiry_id bigint references public.support_inquiries(id) on delete cascade,
  customer_name text not null,
  email text not null,
  response text not null,
  sent_at timestamptz not null default now()
);

create index if not exists support_inquiries_status_idx on public.support_inquiries(status);
create index if not exists support_inquiries_created_at_idx on public.support_inquiries(created_at desc);
create index if not exists support_responses_inquiry_id_idx on public.support_responses(inquiry_id);

alter table public.support_inquiries enable row level security;
alter table public.support_responses enable row level security;

drop policy if exists support_inquiries_select_all on public.support_inquiries;
drop policy if exists support_inquiries_insert_all on public.support_inquiries;
drop policy if exists support_inquiries_update_all on public.support_inquiries;
drop policy if exists support_responses_select_all on public.support_responses;
drop policy if exists support_responses_insert_all on public.support_responses;
drop policy if exists support_responses_update_all on public.support_responses;

create policy support_inquiries_select_all on public.support_inquiries for select using (true);
create policy support_inquiries_insert_all on public.support_inquiries for insert with check (true);
create policy support_inquiries_update_all on public.support_inquiries for update using (true) with check (true);

create policy support_responses_select_all on public.support_responses for select using (true);
create policy support_responses_insert_all on public.support_responses for insert with check (true);
create policy support_responses_update_all on public.support_responses for update using (true) with check (true);

grant execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) to authenticated;
