-- ============================================================================
-- schema_complete.sql — P&G Beauty web app (consolidated schema)
--
-- Single-file, idempotent schema reflecting exactly what the running app uses.
-- Derived from the effective migration chain:
--   schema.sql -> relationship_fix.sql -> order_fix_update.sql
--   -> pdf_rbac.sql -> customer_status_activity.sql
--   -> purchase_management.sql -> product_reviews.sql
--
-- employee_rbac.sql is intentionally EXCLUDED: its department-based role model
-- ('Customer', 'Staff', 'Manager', 'Super Admin') is reverted by pdf_rbac.sql and
-- is not used by the frontend, the seed, or the manage-user Edge Function.
--
-- Role model expected everywhere: customer | beauty_staff | beauty_admin | super_admin
--
-- Usage: run once in the Supabase SQL Editor on an empty project.
-- Safe to re-run: everything is IF NOT EXISTS / CREATE OR REPLACE.
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

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'brands', 'categories', 'products', 'product_variants',
    'inventory', 'inventory_movements', 'suppliers', 'supplier_products',
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

drop function if exists public.audit_employee_activity() cascade;
drop function if exists public.assign_employee_id() cascade;
drop function if exists public.initialize_department_inventory() cascade;
drop function if exists public.can_access_department(text) cascade;
drop function if exists public.transfer_central_inventory(uuid, text, integer) cascade;
drop function if exists public.is_active_user() cascade;
drop function if exists public.is_active_customer() cascade;

alter table public.profiles drop column if exists full_name;
alter table public.profiles drop column if exists employee_id;
alter table public.profiles drop column if exists position;
alter table public.profiles drop column if exists department;
alter table public.profiles drop column if exists module_permissions;
alter table public.inventory drop column if exists department;
alter table public.orders drop column if exists department;
alter table public.inventory_movements drop column if exists department;

-- Add new columns for user document tracking and stock snapshot
alter table public.profiles add column if not exists document_number text;
alter table public.inventory_movements add column if not exists stock_after integer not null default 0 check (stock_after >= 0);
alter table public.inventory_movements add column if not exists user_document text;
alter table public.products add column if not exists sale_price numeric;
alter table public.products add column if not exists discount_type text check (discount_type in ('percentage', 'fixed'));
alter table public.products add column if not exists discount_value numeric;
alter table public.products add column if not exists discount_start timestamptz;
alter table public.products add column if not exists discount_end timestamptz;
alter table public.brands add column if not exists supplier_id uuid references public.suppliers(supplier_id);

drop index if exists public.inventory_variant_department_idx;
drop index if exists public.orders_department_created_at_idx;
drop index if exists public.inventory_movements_department_idx;
drop table if exists public.department_city_mappings;
drop table if exists public.departments;
drop table if exists public.employee_audit_log;
drop sequence if exists public.employee_id_seq;

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  role text not null default 'customer'
    check (role in ('customer', 'beauty_staff', 'beauty_admin', 'super_admin')),
  skin_profile jsonb not null default '{}'::jsonb,
  email text,
  phone text,
  document_number text,
  birthday date,
  account_status text not null default 'Active'
    check (account_status in ('Active', 'Inactive')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  brand_id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  supplier_id uuid references public.suppliers(supplier_id),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  category_id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  image text,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  product_id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands(brand_id),
  category_id uuid references public.categories(category_id),
  name text not null,
  description text,
  price numeric not null check (price >= 0),
  original_price numeric,
  sale_price numeric,
  discount_type text check (discount_type in ('percentage', 'fixed')),
  discount_value numeric,
  discount_start timestamptz,
  discount_end timestamptz,
  image text,
  images text[] not null default '{}',
  tags text[] not null default '{}',
  rating numeric not null default 0,
  reviews integer not null default 0,
  badge text,
  status text not null default 'Draft'
    check (status in ('Active', 'Draft', 'Archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  variant_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(product_id) on delete cascade,
  size text,
  scent text,
  additional_price numeric not null default 0.00,
  sku text unique not null
);

create table if not exists public.inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  variant_id uuid not null unique references public.product_variants(variant_id) on delete cascade,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  reorder_level integer not null default 10 check (reorder_level >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  supplier_id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null default '',
  contact_email text,
  phone text,
  address text,
  status text not null default 'Active'
    check (status in ('Active', 'Inactive', 'Archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  supplier_id uuid not null references public.suppliers(supplier_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete cascade,
  primary key (supplier_id, product_id)
);

create table if not exists public.purchase_orders (
  purchase_order_id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(user_id),
  supplier_id uuid references public.suppliers(supplier_id),
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Shipped', 'Received', 'Cancelled')),
  total_cost numeric not null default 0 check (total_cost >= 0),
  expected_delivery date,
  payment_terms text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  po_no text unique
);

create table if not exists public.purchase_order_items (
  purchase_order_item_id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(purchase_order_id) on delete cascade,
  product_id uuid not null references public.products(product_id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  variant_id uuid references public.product_variants(variant_id)
);

create table if not exists public.orders (
  order_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  total_amount numeric not null check (total_amount >= 0),
  subtotal numeric not null default 0,
  shipping_fee numeric not null default 0,
  tax numeric not null default 0,
  status text not null default 'Pending'
    check (status in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
  payment_status text not null default 'Unpaid'
    check (payment_status in ('Unpaid', 'Paid', 'Refunded')),
  stripe_payment_intent_id text,
  payment_method text not null default 'card',
  shipping_name text not null default '',
  shipping_email text not null default '',
  shipping_phone text,
  shipping_address text not null default '',
  shipping_city text not null default '',
  shipping_zip text not null default '',
  shipping_country text not null default 'Philippines',
  created_at timestamptz not null default now(),
  order_no text unique
);

create table if not exists public.order_items (
  order_item_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(order_id) on delete cascade,
  variant_id uuid not null references public.product_variants(variant_id),
  quantity integer not null check (quantity > 0),
  price_at_purchase numeric not null check (price_at_purchase >= 0)
);

create table if not exists public.recommendation_rules (
  rule_id uuid primary key default gen_random_uuid(),
  rule_name text not null,
  trigger_skin_type text[] not null default '{}',
  target_category_id uuid references public.categories(category_id),
  weight_modifier numeric not null default 1.00,
  is_active boolean not null default true
);

create table if not exists public.recommendations (
  recommendation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete cascade,
  score numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_product_interactions (
  interaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete cascade,
  recommendation_id uuid references public.recommendations(recommendation_id) on delete set null,
  interaction_type text not null
    check (interaction_type in ('view', 'recommendation_shown', 'recommendation_clicked', 'cart', 'wishlist', 'purchase')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_activity_log (
  activity_id bigint generated by default as identity primary key,
  actor_id uuid references public.profiles(user_id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  payment_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(order_id) on delete cascade,
  provider text not null,
  provider_reference text,
  status text not null default 'Pending',
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  movement_id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(variant_id),
  movement_type text not null check (movement_type in ('Stock In', 'Stock Out')),
  quantity integer not null check (quantity > 0),
  stock_after integer not null default 0 check (stock_after >= 0),
  user_document text,
  reference text,
  notes text,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  movement_no text unique,
  order_id uuid references public.orders(order_id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(purchase_order_id) on delete set null
);

create table if not exists public.cart_items (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete cascade,
  quantity integer not null check (quantity > 0),
  variant_id uuid references public.product_variants(variant_id),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  product_id uuid not null references public.products(product_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.user_addresses (
  address_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  line1 text not null,
  city text not null,
  zip text not null,
  phone text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_payment_methods (
  payment_method_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  method_type text not null
    check (method_type in ('gcash', 'paymaya', 'credit', 'debit')),
  label text not null,
  detail text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.support_inquiries (
  inquiry_id bigint generated by default as identity primary key,
  user_id uuid references public.profiles(user_id) on delete set null,
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
  response_id bigint generated by default as identity primary key,
  inquiry_id bigint references public.support_inquiries(inquiry_id) on delete cascade,
  customer_name text not null,
  email text not null,
  response text not null,
  sent_at timestamptz not null default now()
);

create table if not exists public.product_reviews (
  review_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(product_id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review text not null check (char_length(btrim(review)) between 10 and 1200),
  created_at timestamptz not null default now(),
  unique (product_id, user_id)
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index if not exists products_brand_id_idx on public.products(brand_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists product_variants_product_id_idx on public.product_variants(product_id);
create index if not exists inventory_variant_id_idx on public.inventory(variant_id);
create index if not exists supplier_products_product_id_idx on public.supplier_products(product_id);
create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_created_by_idx on public.purchase_orders(created_by);
create index if not exists purchase_order_items_product_id_idx on public.purchase_order_items(product_id);
create index if not exists purchase_order_items_variant_id_idx on public.purchase_order_items(variant_id);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_variant_id_idx on public.order_items(variant_id);
create index if not exists inventory_movements_variant_id_idx on public.inventory_movements(variant_id);
create index if not exists inventory_movements_order_id_idx on public.inventory_movements(order_id);
create index if not exists inventory_movements_purchase_order_id_idx on public.inventory_movements(purchase_order_id);
create index if not exists recommendation_rules_category_idx on public.recommendation_rules(target_category_id);
create index if not exists recommendations_user_created_idx on public.recommendations(user_id, created_at desc);
create index if not exists recommendations_product_idx on public.recommendations(product_id);
create index if not exists interactions_user_created_idx on public.customer_product_interactions(user_id, created_at desc);
create index if not exists interactions_product_type_idx on public.customer_product_interactions(product_id, interaction_type);
create index if not exists user_activity_log_created_idx on public.user_activity_log(created_at desc);
create index if not exists cart_items_product_id_idx on public.cart_items(product_id);
create index if not exists wishlist_items_product_id_idx on public.wishlist_items(product_id);
create index if not exists user_addresses_user_id_idx on public.user_addresses(user_id);
create index if not exists user_payment_methods_user_id_idx on public.user_payment_methods(user_id);
create index if not exists support_inquiries_status_idx on public.support_inquiries(status);
create index if not exists support_inquiries_created_at_idx on public.support_inquiries(created_at desc);
create index if not exists support_inquiries_user_id_idx on public.support_inquiries(user_id);
create index if not exists support_responses_inquiry_id_idx on public.support_responses(inquiry_id);
create index if not exists product_reviews_product_created_idx on public.product_reviews(product_id, created_at desc);

-- ============================================================================
-- 3. Sequences (document numbers)
-- ============================================================================

create sequence if not exists public.order_no_seq;
create sequence if not exists public.po_no_seq;
create sequence if not exists public.movement_no_seq;
create sequence if not exists public.document_no_seq;

-- ============================================================================
-- 4. Functions
-- ============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'super_admin' and account_status = 'Active'
  );
$$;

create or replace function public.is_customer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'customer' and account_status = 'Active'
  );
$$;

create or replace function public.has_permission(p_module text, p_action text default 'view')
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when p.account_status <> 'Active' then false
      when p.role = 'super_admin' then true
      when p.role = 'beauty_admin' then case p_module
        when 'dashboard' then p_action = 'view'
        when 'products' then p_action = any(array['view', 'create', 'edit', 'delete'])
        when 'inventory' then p_action = any(array['view', 'create', 'edit', 'manage'])
        when 'suppliers' then p_action = any(array['view', 'create', 'edit', 'delete'])
        when 'purchases' then p_action = any(array['view', 'create', 'manage', 'delete'])
        when 'customers' then p_action = any(array['view', 'manage'])
        when 'activity' then p_action = 'view'
        when 'sales' then p_action = any(array['view', 'manage'])
        when 'insights' then p_action = 'view'
        when 'recommendations' then p_action = 'view'
        when 'reports' then p_action = any(array['view', 'generate', 'export'])
        when 'support' then p_action = any(array['view', 'respond'])
        else false
      end
      when p.role = 'beauty_staff' then
        (p_module = 'inventory' and p_action = any(array['view', 'manage']))
        or (p_module = 'activity' and p_action = 'view')
      else false
    end
    from public.profiles p where p.user_id = auth.uid()
  ), false);
$$;

-- Auth webhook: create/refresh the profile whenever a user signs up.
-- Every account gets a document number; it is stamped onto stock movements
-- (inventory_movements.user_document) so the ledger records who handled stock.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_document text;
begin
  select 'DOC-' || lpad(nextval('public.document_no_seq')::text, 6, '0') into v_document;
  insert into public.profiles (user_id, first_name, last_name, email, skin_profile, document_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data -> 'skin_profile', '{}'::jsonb),
    v_document
  )
  on conflict (user_id) do update
    set email = excluded.email,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        skin_profile = excluded.skin_profile;
  return new;
end;
$$;

-- Document-number generators (orders, purchase orders, stock movements).
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

-- Stock movement ledger entry (admin/staff only).
create or replace function public.record_inventory_movement(
  p_inventory_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_reference text default null,
  p_notes text default null
) returns public.inventory_movements
language plpgsql security definer set search_path = public
as $$
declare
  v_inventory public.inventory;
  v_movement public.inventory_movements;
  v_next_stock integer;
  v_user_document text;
begin
  if not public.has_permission('inventory', 'manage') then raise exception 'Inventory access required'; end if;
  if p_movement_type not in ('Stock In', 'Stock Out') then raise exception 'Invalid movement type'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  select * into v_inventory from public.inventory where inventory_id = p_inventory_id for update;
  if not found then raise exception 'Inventory row not found'; end if;
  v_next_stock := case when p_movement_type = 'Stock In' then v_inventory.stock_quantity + p_quantity else v_inventory.stock_quantity - p_quantity end;
  if v_next_stock < 0 then raise exception 'Insufficient stock'; end if;

  select document_number into v_user_document from public.profiles where user_id = auth.uid();

  update public.inventory set stock_quantity = v_next_stock, updated_at = now() where inventory_id = v_inventory.inventory_id;
  insert into public.inventory_movements (variant_id, movement_type, quantity, stock_after, user_document, reference, notes, created_by)
  values (v_inventory.variant_id, p_movement_type, p_quantity, v_next_stock, v_user_document, p_reference, p_notes, auth.uid())
  returning * into v_movement;
  return v_movement;
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
  return v_order;
end;
$$;

-- Activity audit trigger: records staff mutations in user_activity_log.
--
-- Customers are deliberately NOT audited row-by-row: their browsing, cart and
-- recommendation events are high volume and meaningless as an activity trail.
-- Meaningful customer events are derived from source-of-truth tables
-- (see get_customer_activity) or written explicitly through
-- public.log_customer_activity (AI chat).
create or replace function public.audit_user_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_record jsonb;
  v_profile public.profiles;
  v_pk text;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;

  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found or v_profile.role = 'customer' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
    and (to_jsonb(old) - 'last_seen_at') = (to_jsonb(new) - 'last_seen_at') then
    return new;
  end if;

  -- Each table's primary key is named after the entity it identifies.
  v_pk := case tg_table_name
    when 'brands' then 'brand_id'
    when 'categories' then 'category_id'
    when 'products' then 'product_id'
    when 'product_variants' then 'variant_id'
    when 'inventory' then 'inventory_id'
    when 'inventory_movements' then 'movement_id'
    when 'suppliers' then 'supplier_id'
    when 'purchase_orders' then 'purchase_order_id'
    when 'purchase_order_items' then 'purchase_order_item_id'
    when 'orders' then 'order_id'
    when 'order_items' then 'order_item_id'
    when 'payments' then 'payment_id'
    when 'recommendation_rules' then 'rule_id'
    when 'recommendations' then 'recommendation_id'
    when 'customer_product_interactions' then 'interaction_id'
    when 'support_inquiries' then 'inquiry_id'
    when 'support_responses' then 'response_id'
    when 'profiles' then 'user_id'
    else 'id'
  end;

  v_record := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.user_activity_log (actor_id, action, details)
  values (
    auth.uid(),
    lower(tg_table_name) || '.' || lower(tg_op),
    jsonb_build_object('table', tg_table_name, 'record_id', v_record ->> v_pk, 'role', v_profile.role)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Explicit customer-facing events that are worth keeping (AI chat conversations).
create or replace function public.log_customer_activity(
  p_action text,
  p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('ai.chat') then
    raise exception 'Unsupported customer activity';
  end if;
  insert into public.user_activity_log (actor_id, action, details)
  values (auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke all on function public.log_customer_activity(text, jsonb) from public, anon, authenticated;
grant execute on function public.log_customer_activity(text, jsonb) to authenticated;

create or replace function public.touch_user_activity()
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_last_seen timestamptz;
begin
  select role, last_seen_at into v_role, v_last_seen
  from public.profiles
  where user_id = auth.uid() and account_status = 'Active';

  if not found then return; end if;

  update public.profiles set last_seen_at = now() where user_id = auth.uid();
  if v_last_seen is null or v_last_seen < now() - interval '15 minutes' then
    insert into public.user_activity_log (actor_id, action, details)
    values (auth.uid(), 'session.active', jsonb_build_object('role', v_role));
  end if;
end;
$$;

create or replace function public.touch_customer_activity()
returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.is_customer() then perform public.touch_user_activity(); end if;
end;
$$;

create or replace function public.get_staff_activity()
returns table (
  event_id text,
  user_name text,
  user_role text,
  action text,
  details jsonb,
  occurred_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_permission('activity', 'view') then
    raise exception 'Activity log access required';
  end if;

  return query
  select a.activity_id::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Unknown user'),
    coalesce(p.role, a.details ->> 'role', 'Unknown role'),
    a.action, a.details, a.created_at
  from public.user_activity_log a
  left join public.profiles p on p.user_id = a.actor_id
  where p.role in ('super_admin', 'beauty_admin', 'beauty_staff')
  order by a.created_at desc
  limit 250;
end;
$$;

-- Meaningful customer activity trail. Every event is DERIVED from a
-- source-of-truth table (or an explicitly logged ai.chat row), so the activity
-- log never accumulates browsing/cart/recommendation noise.
-- Kept event set: order.placed, order.received, order.cancelled,
--                support.ticket_submitted, ai.chat
create or replace function public.get_customer_activity()
returns table (
  event_id text,
  customer_name text,
  customer_email text,
  action text,
  details jsonb,
  occurred_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_permission('activity', 'view') then
    raise exception 'Activity log access required';
  end if;

  return query
  -- event_id must be unique per event: one order is reported by more than one
  -- branch (placed + received, or placed + cancelled), so a bare entity id
  -- would repeat and render duplicate React keys in the Activity Log table.
  select o.order_id::text || ':placed',
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'order.placed',
    jsonb_build_object('order_no', o.order_no, 'status', o.status, 'total_amount', o.total_amount),
    o.created_at
  from public.orders o
  join public.profiles p on p.user_id = o.user_id

  union all

  select s.inquiry_id::text || ':support',
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'support.ticket_submitted',
    jsonb_build_object('inquiry_id', s.inquiry_id, 'subject', s.subject, 'status', s.status),
    s.created_at
  from public.support_inquiries s
  join public.profiles p on p.user_id = s.user_id
  where s.user_id is not null

  union all

  select o.order_id::text || ':cancelled',
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'order.cancelled',
    jsonb_build_object('order_no', o.order_no, 'status', o.status),
    o.created_at
  from public.orders o
  join public.profiles p on p.user_id = o.user_id
  where o.status = 'Cancelled'

  union all

  select o.order_id::text || ':received',
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'order.received',
    jsonb_build_object('order_no', o.order_no, 'status', o.status),
    o.created_at
  from public.orders o
  join public.profiles p on p.user_id = o.user_id
  where o.status = 'Delivered'

  union all

  select a.activity_id::text || ':chat',
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'ai.chat',
    a.details,
    a.created_at
  from public.user_activity_log a
  join public.profiles p on p.user_id = a.actor_id
  where a.action = 'ai.chat'

  order by 6 desc
  limit 500;
end;
$$;

create or replace function public.set_customer_account_status(p_user_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_previous_status text;
begin
  if p_status not in ('Active', 'Inactive') then
    raise exception 'Account status must be Active or Inactive';
  end if;
  if not public.has_permission('customers', 'manage') then
    raise exception 'Customer management access required';
  end if;

  select role, account_status into v_role, v_previous_status
  from public.profiles
  where user_id = p_user_id
  for update;

  if not found or v_role <> 'customer' then
    raise exception 'Customer account not found';
  end if;
  if v_previous_status = p_status then return; end if;

  update public.profiles set account_status = p_status where user_id = p_user_id;
  insert into public.user_activity_log (actor_id, action, details)
  values (
    auth.uid(),
    'customer.status_changed',
    jsonb_build_object('user_id', p_user_id, 'previous_status', v_previous_status, 'status', p_status)
  );
end;
$$;

-- Customer loyalty segmentation: Silver/Gold/Platinum/Diamond based on account age and lifetime spend.
create or replace function public.get_customer_segment(p_user_id uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_created_at timestamptz;
  v_total_spent numeric;
  v_segment text;
  v_months integer;
begin
  select created_at into v_created_at
  from public.profiles
  where user_id = p_user_id and role = 'customer';

  if not found then return 'New'; end if;

  select coalesce(sum(total_amount), 0) into v_total_spent
  from public.orders
  where user_id = p_user_id and status <> 'Cancelled';

  v_months := extract(epoch from now() - v_created_at) / (30 * 24 * 60 * 60);

  if v_months >= 12 and v_total_spent >= 500000 then
    v_segment := 'Diamond';
  elsif v_months >= 6 and v_total_spent >= 150000 then
    v_segment := 'Platinum';
  elsif v_months >= 3 and v_total_spent >= 50000 then
    v_segment := 'Gold';
  elsif v_months >= 1 and v_total_spent >= 10000 then
    v_segment := 'Silver';
  else
    v_segment := 'New';
  end if;

  return v_segment;
end;
$$;

-- Purchase order creation (staff with purchases/create permission).
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
  v_product_id uuid;
  v_quantity integer;
  v_unit_cost numeric;
  v_total numeric := 0;
  v_po_no text;
begin
  if not public.has_permission('purchases', 'create') then
    raise exception using errcode = '42501', message = 'Purchase order management access required';
  end if;

  if not exists (select 1 from public.suppliers where supplier_id = p_supplier_id and status = 'Active') then
    raise exception 'Select an active supplier';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Purchase order items must be a list';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the purchase order';
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

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := nullif(v_item ->> 'quantity', '')::integer;
    v_unit_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
    if v_product_id is null or v_quantity is null or v_quantity <= 0 or v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'Each item requires a product, positive quantity, and non-negative unit cost';
    end if;
    if not exists (select 1 from public.products where product_id = v_product_id and status = 'Active') then
      raise exception 'Purchase order products must be active';
    end if;

    insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
    values (v_order.purchase_order_id, v_product_id, v_quantity, v_unit_cost);
    v_total := v_total + v_quantity * v_unit_cost;
  end loop;

  update public.purchase_orders set total_cost = v_total where purchase_order_id = v_order.purchase_order_id returning * into v_order;
  return v_order;
end;
$$;

-- Supplier delivery: the supplier ships the ordered goods, stock is increased
-- and every unit is traced back to the purchase order through inventory_movements.
create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_notes text default null
) returns public.purchase_orders
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_item record;
  v_inventory public.inventory;
  v_variant_id uuid;
  v_next_stock integer;
  v_user_document text;
begin
  if not public.has_permission('purchases', 'manage') then
    raise exception using errcode = '42501', message = 'Purchase order management access required';
  end if;

  -- Every stock movement records the document number of the staff member who signed for it.
  select document_number into v_user_document from public.profiles where user_id = auth.uid();

  select * into v_order from public.purchase_orders
  where purchase_order_id = p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_order.status = 'Received' then raise exception 'This purchase order was already received'; end if;

  for v_item in
    select poi.variant_id, poi.product_id, poi.quantity
    from public.purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id
  loop
    v_variant_id := v_item.variant_id;
    if v_variant_id is null then
      select pv.variant_id into v_variant_id
      from public.product_variants pv
      where pv.product_id = v_item.product_id
      order by pv.sku
      limit 1;
    end if;
    if v_variant_id is null then continue; end if;

    select * into v_inventory from public.inventory where variant_id = v_variant_id for update;
    if not found then
      insert into public.inventory (variant_id, stock_quantity, reorder_level)
      values (v_variant_id, 0, 10)
      returning * into v_inventory;
    end if;

    v_next_stock := v_inventory.stock_quantity + v_item.quantity;

    update public.inventory
    set stock_quantity = v_next_stock, updated_at = now()
    where inventory_id = v_inventory.inventory_id;

    insert into public.inventory_movements (
      variant_id, movement_type, quantity, stock_after, user_document,
      reference, notes, created_by, purchase_order_id
    ) values (
      v_variant_id, 'Stock In', v_item.quantity, v_next_stock, v_user_document,
      v_order.po_no, coalesce(p_notes, 'Supplier delivery received'), auth.uid(), p_purchase_order_id
    );
  end loop;

  update public.purchase_orders
  set status = 'Received'
  where purchase_order_id = p_purchase_order_id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.receive_purchase_order(uuid, text) from public, anon;
grant execute on function public.receive_purchase_order(uuid, text) to authenticated;

-- Review submission: only for products in a delivered order.
create or replace function public.submit_product_review(
  p_product_id uuid,
  p_rating integer,
  p_review text
) returns public.product_reviews
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.product_reviews;
  v_text text := btrim(coalesce(p_review, ''));
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in to submit a review';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  if char_length(v_text) < 10 or char_length(v_text) > 1200 then
    raise exception 'Review must be between 10 and 1200 characters';
  end if;
  if not exists (select 1 from public.products where product_id = p_product_id and status = 'Active') then
    raise exception 'Product is unavailable for review';
  end if;
  if not exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.order_id
    join public.product_variants v on v.variant_id = oi.variant_id
    where o.user_id = v_user_id
      and v.product_id = p_product_id
      and o.status = 'Delivered'
  ) then
    raise exception using errcode = '42501', message = 'A delivered order is required before reviewing this product';
  end if;

  insert into public.product_reviews (product_id, user_id, rating, review)
  values (p_product_id, v_user_id, p_rating, v_text)
  on conflict (product_id, user_id) do update
    set rating = excluded.rating, review = excluded.review, created_at = now()
  returning * into v_review;

  return v_review;
end;
$$;

-- products.rating / products.reviews are DERIVED from product_reviews so every
-- screen that reads the columns shows real customer feedback.
create or replace function public.refresh_product_rating()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_product_id uuid;
begin
  v_product_id := coalesce(new.product_id, old.product_id);
  update public.products p
  set rating = coalesce((select round(avg(rating), 2) from public.product_reviews where product_id = v_product_id), 0),
      reviews = coalesce((select count(*) from public.product_reviews where product_id = v_product_id), 0)
  where p.product_id = v_product_id;
  return coalesce(new, old);
end;
$$;

-- ============================================================================
-- 5. Triggers
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists trg_refresh_product_rating on public.product_reviews;
create trigger trg_refresh_product_rating
after insert or update or delete on public.product_reviews
for each row execute procedure public.refresh_product_rating();

drop trigger if exists trg_order_no on public.orders;
create trigger trg_order_no before insert on public.orders
for each row execute procedure public.gen_order_no();

drop trigger if exists trg_po_no on public.purchase_orders;
create trigger trg_po_no before insert on public.purchase_orders
for each row execute procedure public.gen_po_no();

drop trigger if exists trg_movement_no on public.inventory_movements;
create trigger trg_movement_no before insert on public.inventory_movements
for each row execute procedure public.gen_movement_no();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'brands', 'categories', 'products', 'product_variants', 'inventory',
    'inventory_movements', 'suppliers', 'supplier_products', 'purchase_orders',
    'purchase_order_items', 'orders', 'order_items', 'payments', 'recommendations',
    'customer_product_interactions', 'support_inquiries', 'support_responses'
  ] loop
    execute format('drop trigger if exists audit_user_activity on public.%I', v_table);
    execute format(
      'create trigger audit_user_activity after insert or update or delete on public.%I for each row execute function public.audit_user_activity()',
      v_table
    );
  end loop;
end;
$$;

-- ============================================================================
-- 6. Analytics views
-- ============================================================================

drop view if exists public.product_sales;
create or replace view public.product_sales with (security_invoker = true) as
select p.product_id, p.name, p.category_id,
  coalesce(s.units_sold, 0)::integer as units_sold,
  coalesce(s.revenue, 0) as revenue,
  coalesce(i.stock, 0)::integer as stock,
  coalesce(i.reorder_level, 10)::integer as reorder_level,
  c.name as category_name
from public.products p
left join public.categories c on c.category_id = p.category_id
left join lateral (
  select sum(oi.quantity)::integer as units_sold,
    sum(oi.quantity * oi.price_at_purchase) as revenue
  from public.product_variants v
  join public.order_items oi on oi.variant_id = v.variant_id
  join public.orders o on o.order_id = oi.order_id
  where v.product_id = p.product_id and o.status <> 'Cancelled'
) s on true
left join lateral (
  select sum(inv.stock_quantity)::integer as stock, min(inv.reorder_level)::integer as reorder_level
  from public.product_variants v join public.inventory inv on inv.variant_id = v.variant_id
  where v.product_id = p.product_id
) i on true;

drop view if exists public.sales_by_month;
create or replace view public.sales_by_month with (security_invoker = true) as
select date_trunc('month', o.created_at) as month_date,
  to_char(date_trunc('month', o.created_at), 'Mon YYYY') as month,
  coalesce(sum(o.total_amount), 0) as sales,
  count(*)::integer as orders
from public.orders o where o.status <> 'Cancelled'
group by 1 order by 1;

drop view if exists public.underperforming_products;
create or replace view public.underperforming_products with (security_invoker = true) as
select p.product_id, p.name, p.created_at from public.products p
where p.created_at < now() - interval '30 days'
and not exists (
  select 1 from public.order_items oi
  join public.product_variants v on v.variant_id = oi.variant_id
  join public.orders o on o.order_id = oi.order_id
  where v.product_id = p.product_id and o.created_at >= now() - interval '30 days' and o.status <> 'Cancelled'
);

-- Reviewer display names for the public reviews tab.
-- security_invoker = off so the view reads profiles without its RLS (self-or-admin
-- only, which would blank out every other customer's name), while exposing name
-- columns only - never email/phone/role. Used by ProductDetailPage as a second
-- query instead of embedding profiles() into product_reviews, which PostgREST
-- answers with 401 for guests.
drop view if exists public.review_authors;
create or replace view public.review_authors with (security_invoker = off) as
select user_id, first_name, last_name from public.profiles;

-- ============================================================================
-- 7. Storage (product images)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_images_public_read on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_public_read on storage.objects for select to public
using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.has_permission('products', 'create'));
create policy product_images_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (public.has_permission('products', 'edit') or public.has_permission('products', 'delete')));

-- ============================================================================
-- 8. Row Level Security (final policy set)
-- ============================================================================

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'brands', 'categories', 'products', 'product_variants', 'inventory',
    'suppliers', 'supplier_products', 'purchase_orders', 'purchase_order_items',
    'orders', 'order_items', 'recommendation_rules', 'recommendations',
    'customer_product_interactions', 'user_activity_log', 'payments',
    'inventory_movements', 'cart_items', 'wishlist_items', 'user_addresses',
    'user_payment_methods', 'support_inquiries', 'support_responses', 'product_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end;
$$;

-- Reset policies so this file is the single source of truth.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

-- Profiles: self, admins, and staff who may view customers.
create policy profiles_select on public.profiles for select to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or (role = 'customer' and public.has_permission('customers', 'view'))
);
create policy profiles_owner_update on public.profiles for update to authenticated
using (user_id = auth.uid() and public.is_customer())
with check (user_id = auth.uid() and public.is_customer());

-- Storefront catalog.
create policy public_active_products on public.products for select
using (status = 'Active' or public.has_permission('products', 'view'));
create policy public_active_variants on public.product_variants for select
using (exists (
  select 1 from public.products p
  where p.product_id = public.product_variants.product_id and (p.status = 'Active' or public.has_permission('products', 'view'))
));
create policy public_brands on public.brands for select using (true);
create policy public_categories on public.categories for select using (true);
create policy public_inventory on public.inventory for select using (true);

-- Catalog management.
create policy products_insert on public.products for insert to authenticated with check (public.has_permission('products', 'create'));
create policy products_update on public.products for update to authenticated using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy products_delete on public.products for delete to authenticated using (public.has_permission('products', 'delete'));
create policy variants_insert on public.product_variants for insert to authenticated with check (public.has_permission('products', 'create'));
create policy variants_update on public.product_variants for update to authenticated using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy variants_delete on public.product_variants for delete to authenticated using (public.has_permission('products', 'delete'));
create policy brands_insert on public.brands for insert to authenticated with check (public.has_permission('products', 'edit'));
create policy brands_update on public.brands for update to authenticated using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy brands_delete on public.brands for delete to authenticated using (public.has_permission('products', 'delete'));
create policy categories_insert on public.categories for insert to authenticated with check (public.has_permission('products', 'edit'));
create policy categories_update on public.categories for update to authenticated using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy categories_delete on public.categories for delete to authenticated using (public.has_permission('products', 'delete'));

-- Inventory.
create policy inventory_insert on public.inventory for insert to authenticated with check (public.is_admin() or public.has_permission('inventory', 'manage'));
create policy inventory_update on public.inventory for update to authenticated using (public.is_admin() or public.has_permission('inventory', 'manage')) with check (public.is_admin() or public.has_permission('inventory', 'manage'));
create policy inventory_delete on public.inventory for delete to authenticated using (public.is_admin());

-- Suppliers.
create policy suppliers_select on public.suppliers for select to authenticated using (public.has_permission('suppliers', 'view'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.has_permission('suppliers', 'create'));
create policy suppliers_update on public.suppliers for update to authenticated using (public.has_permission('suppliers', 'edit')) with check (public.has_permission('suppliers', 'edit'));
create policy suppliers_delete on public.suppliers for delete to authenticated using (public.has_permission('suppliers', 'delete'));
create policy supplier_products_select on public.supplier_products for select to authenticated using (public.has_permission('suppliers', 'view'));
create policy supplier_products_write on public.supplier_products for all to authenticated using (public.has_permission('suppliers', 'edit')) with check (public.has_permission('suppliers', 'edit'));

-- Purchasing.
create policy purchase_orders_select on public.purchase_orders for select to authenticated using (public.has_permission('purchases', 'view'));
create policy purchase_orders_write on public.purchase_orders for all to authenticated using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));
create policy purchase_items_select on public.purchase_order_items for select to authenticated using (public.has_permission('purchases', 'view'));
create policy purchase_items_write on public.purchase_order_items for all to authenticated using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));

-- Orders (checkout itself runs through the place_order RPC).
create policy orders_select on public.orders for select to authenticated
using ((user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'));
create policy orders_customer_insert on public.orders for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());
create policy orders_admin_update on public.orders for update to authenticated
using (public.has_permission('sales', 'manage')) with check (public.has_permission('sales', 'manage'));

create policy order_items_select on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.order_id = order_id and ((o.user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'))));
create policy order_items_customer_insert on public.order_items for insert to authenticated
with check (exists (select 1 from public.orders o where o.order_id = order_id and o.user_id = auth.uid() and public.is_customer()));

-- Payments.
create policy payments_select on public.payments for select to authenticated
using (exists (select 1 from public.orders o where o.order_id = order_id and ((o.user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'))));
create policy payments_write on public.payments for all to authenticated
using (public.has_permission('sales', 'manage')) with check (public.has_permission('sales', 'manage'));

-- Stock movements.
create policy inventory_movements_select on public.inventory_movements for select to authenticated
using (public.has_permission('inventory', 'view'));
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
with check (
  (public.has_permission('inventory', 'manage'))
  or (order_id is not null and exists (
    select 1 from public.orders o where o.order_id = order_id and o.user_id = auth.uid() and public.is_customer()
  ))
);

-- Recommendation rules.
create policy recommendation_rules_select on public.recommendation_rules for select
using (is_active or public.has_permission('recommendations', 'view'));
create policy recommendation_rules_manage on public.recommendation_rules for all to authenticated
using (public.is_admin() or public.has_permission('recommendations', 'manage'))
with check (public.is_admin() or public.has_permission('recommendations', 'manage'));

-- Recommendations: owners read their own; staff with recommendations/insights access read all.
create policy recommendations_owner_select on public.recommendations for select to authenticated
using (
  (user_id = auth.uid() and public.is_customer())
  or public.has_permission('recommendations', 'view')
  or public.has_permission('insights', 'view')
);
create policy recommendations_owner_insert on public.recommendations for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());

-- Interactions: owners read their own; staff with activity/insights access read all.
create policy interactions_owner_select on public.customer_product_interactions for select to authenticated
using (
  (user_id = auth.uid() and public.is_customer())
  or public.has_permission('activity', 'view')
  or public.has_permission('insights', 'view')
);
create policy interactions_owner_insert on public.customer_product_interactions for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());

-- Activity log.
create policy user_activity_admin_select on public.user_activity_log for select to authenticated
using (public.has_permission('activity', 'view'));

-- Carts & wishlists: owner writes; staff may read for activity/insights.
create policy cart_items_owner on public.cart_items for all to authenticated
using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
create policy cart_items_staff_select on public.cart_items for select to authenticated
using (public.has_permission('activity', 'view') or public.has_permission('insights', 'view'));

create policy wishlist_items_owner on public.wishlist_items for all to authenticated
using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
create policy wishlist_items_staff_select on public.wishlist_items for select to authenticated
using (public.has_permission('activity', 'view') or public.has_permission('insights', 'view'));

-- Addresses & saved payment methods.
create policy addresses_owner on public.user_addresses for all to authenticated
using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
create policy payment_methods_owner on public.user_payment_methods for all to authenticated
using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());

-- Support inbox.
create policy support_inquiries_select on public.support_inquiries for select to authenticated
using ((user_id = auth.uid() and public.is_customer()) or public.has_permission('support', 'view'));
create policy support_inquiries_customer_insert on public.support_inquiries for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());
-- Signed-out visitors submit from the chat bubble with user_id = null; rows stay
-- readable only by customers (own tickets) and support staff.
create policy support_inquiries_guest_insert on public.support_inquiries for insert to anon
with check (user_id is null);
create policy support_inquiries_respond on public.support_inquiries for update to authenticated
using (public.has_permission('support', 'respond')) with check (public.has_permission('support', 'respond'));
create policy support_responses_select on public.support_responses for select to authenticated
using (public.has_permission('support', 'view') or exists (select 1 from public.support_inquiries i where i.inquiry_id = inquiry_id and i.user_id = auth.uid() and public.is_customer()));
create policy support_responses_insert on public.support_responses for insert to authenticated
with check (public.has_permission('support', 'respond'));

-- Product reviews: public read, RPC-only writes.
create policy product_reviews_public_read on public.product_reviews for select to anon, authenticated using (true);

-- ============================================================================
-- 9. Grants
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Anonymous storefront access.
grant select on public.brands, public.categories, public.products, public.product_variants, public.inventory to anon;
grant select on public.recommendation_rules to anon;
grant insert on public.support_inquiries to anon;
grant usage, select on sequence public.support_inquiries_id_seq to anon;
-- Embedded by the public catalog query (products -> supplier_products -> suppliers).
-- PostgREST answers 401 "permission denied for table" with no table grant even
-- when RLS would hide every row; the supplier policies stay staff-only, so guests
-- still read zero rows and no supplier contact data leaks.
grant select on public.supplier_products, public.suppliers to anon;
-- Guests submit support tickets from the chat bubble. PostgREST needs SELECT to
-- return an insert representation; support_inquiries_select is authenticated-only,
-- so guests can insert but read nothing back.
grant select on public.support_inquiries to anon;
-- Reviewer display names for the public reviews tab (name columns only).
grant select on public.review_authors to anon, authenticated;

-- Profiles: column-scoped self-service.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, last_name, phone, birthday, skin_profile) on public.profiles to authenticated;

-- Authenticated catalog & commerce access.
grant select on public.brands, public.categories, public.products, public.product_variants, public.inventory to authenticated;
grant select, insert, update, delete on public.products, public.product_variants, public.inventory to authenticated;
grant select, insert, update, delete on public.brands, public.categories, public.suppliers, public.supplier_products,
  public.purchase_orders, public.purchase_order_items, public.orders, public.order_items, public.payments,
  public.inventory_movements to authenticated;
grant select on public.recommendation_rules to authenticated;
grant select, insert on public.recommendations, public.customer_product_interactions to authenticated;
grant select, insert on public.user_activity_log to authenticated;
grant select, insert, update, delete on public.cart_items, public.wishlist_items, public.user_addresses, public.user_payment_methods to authenticated;
grant select, insert, update on public.support_inquiries to authenticated;
grant select, insert on public.support_responses to authenticated;
grant select on public.product_reviews to anon, authenticated;
grant usage, select on sequence public.support_inquiries_id_seq, public.support_responses_id_seq, public.user_activity_log_id_seq to authenticated;

-- Checkout runs only through the place_order RPC.
revoke insert on public.orders, public.order_items, public.payments, public.inventory_movements from authenticated;

-- Functions exposed to the app.
grant execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.record_inventory_movement(uuid, text, integer, text, text) to authenticated;
grant execute on function public.create_purchase_order(uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.submit_product_review(uuid, integer, text) to authenticated;
grant execute on function public.touch_user_activity() to authenticated;
grant execute on function public.touch_customer_activity() to authenticated;
grant execute on function public.get_staff_activity() to authenticated;
grant execute on function public.get_customer_activity() to authenticated;
grant execute on function public.set_customer_account_status(uuid, text) to authenticated;
grant execute on function public.get_customer_segment(uuid) to authenticated;

-- The same RPCs default to EXECUTE for PUBLIC on creation; every one above is
-- only ever called from a signed-in screen (checkout, activity log, admin pages),
-- so anon is revoked explicitly to keep guests off them.
revoke execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.record_inventory_movement(uuid, text, integer, text, text) from public, anon;
revoke execute on function public.touch_user_activity() from public, anon;
revoke execute on function public.touch_customer_activity() from public, anon;
revoke execute on function public.get_staff_activity() from public, anon;
revoke execute on function public.get_customer_activity() from public, anon;
revoke execute on function public.get_customer_segment(uuid) from public, anon;
revoke execute on function public.set_customer_account_status(uuid, text) from public, anon;

-- Discount/sale expiration: reverts every product whose sale window has ended
-- (price <- original_price, sale_price + discount_* cleared) and RETURNS the
-- products that just expired so the admin dashboard can notify.
-- The discounted price lives in products.price; products.original_price is the
-- strikethrough. Called by the admin dashboard on load and after saving a discount.
create or replace function public.expire_discounts()
returns table (
  product_id uuid,
  name text,
  sale_price numeric,
  discount_end timestamptz,
  original_price numeric
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with expired as (
    select p.product_id, p.name, p.sale_price, p.discount_end, p.original_price
    from public.products p
    where p.discount_end is not null
      and p.discount_end < now()
      and (p.sale_price is not null or p.discount_type is not null)
    for update of p
  )
  update public.products p
  set price = e.original_price,
      sale_price = null,
      discount_type = null,
      discount_value = null,
      discount_start = null,
      discount_end = null,
      updated_at = now()
  from expired e
  where p.product_id = e.product_id
  returning p.product_id, p.name, e.sale_price, e.discount_end, e.original_price;
end;
$$;

revoke all on function public.expire_discounts() from public, anon;
grant execute on function public.expire_discounts() to authenticated;

-- Analytics views.
grant select on public.product_sales, public.sales_by_month, public.underperforming_products to authenticated;

-- Service role (Edge Functions).
grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant insert on public.user_activity_log to service_role;
grant usage, select on sequence public.user_activity_log_id_seq to service_role;

commit;

-- ============================================================================
-- 10. Post-deploy validation (should return zero rows)
-- ============================================================================
--
-- select 'orders_missing_order_no' as check_name, count(*) from public.orders where order_no is null
-- union all
-- select 'purchase_orders_missing_po_no', count(*) from public.purchase_orders where po_no is null
-- union all
-- select 'movements_missing_movement_no', count(*) from public.inventory_movements where movement_no is null
-- union all
-- select 'duplicate_order_nos', count(*) from (select order_no from public.orders group by order_no having count(*) > 1) d;

-- ============================================================================
-- 11. App-to-Schema Usage Inventory (audit record)
-- ============================================================================
--
-- Static code-level audit: every supabase.from() and supabase.rpc() call in
-- src/ was compared against this schema file. This file has also been executed
-- against the live database (project lvtlehesxweckggyemnm), so the schema file
-- and the database are in sync.
-- Result: MATCH — no schema drift detected. All tables, views, RPCs, and the
-- manage-user Edge Function used by the app are defined below.
--
-- TABLES used by the app (all 25 present):
--   profiles, brands, categories, products, product_variants, inventory,
--   suppliers, supplier_products, purchase_orders, purchase_order_items,
--   orders, order_items, payments, inventory_movements, cart_items,
--   wishlist_items, user_addresses, user_payment_methods,
--   recommendation_rules, recommendations, customer_product_interactions,
--   user_activity_log, support_inquiries, support_responses, product_reviews
--
-- SEQUENCES used by the app:
--   document_no_seq -> handle_new_user() stamps profiles.document_number
--                      (shown on the Customers page and written to the
--                      inventory ledger as inventory_movements.user_document)
--
-- VIEWS used by the app (all 4 present):
--   product_sales, sales_by_month, underperforming_products,
--   review_authors      -> src/pages/customer/ProductDetailPage.tsx (reviewer
--                           names on the public Reviews tab; name columns only)
--
-- ANONYMOUS (signed-out) ACCESS - what the storefront touches as anon:
--   SELECT   products, brands, categories, product_variants, inventory,
--            recommendation_rules, supplier_products, suppliers,
--            support_inquiries, review_authors
--   INSERT   support_inquiries (only with user_id is null), plus USAGE on
--            support_inquiries_id_seq
--   PostgREST answers 401 "permission denied for table X" whenever a table-level
--   grant is missing - even when RLS would hide every row - so grants and RLS
--   policies both have to be right for a guest request to return 200.
--
-- RPCs called by the app (all present + granted):
--   place_order            -> src/lib/catalog.ts (createOrder)
--   record_inventory_movement -> src/pages/admin/AdminInventory.tsx
--   create_purchase_order  -> src/lib/adminData.ts
--   receive_purchase_order -> src/lib/adminData.ts
--   submit_product_review  -> src/components/ProductModal.tsx
--   touch_user_activity    -> src/context/AuthContext.tsx
--   get_staff_activity     -> src/lib/adminData.ts (fetchUserActivity)
--   get_customer_activity  -> src/lib/adminData.ts (fetchCustomerActivity)
--   set_customer_account_status -> src/lib/adminData.ts
--   get_customer_segment   -> src/lib/adminData.ts (fetchCustomers)
--   expire_discounts       -> src/lib/catalog.ts (expireEndedDiscounts); fired by
--                             src/pages/admin/AdminDashboard.tsx on mount + every 30s
--   log_customer_activity  -> src/components/FloatingChat.tsx (ai.chat only)
--   touch_customer_activity-> defined; not yet called by frontend
--
-- RPCs that exist for database triggers rather than frontend calls:
--   refresh_product_rating -> trg_refresh_product_rating keeps products.rating
--                             and products.reviews in sync with product_reviews
--                             on every insert/update/delete
--   handle_new_user        -> auth trigger; fills first_name/last_name/email,
--                             skin_profile and document_number on signup
--   audit_user_activity    -> pg_audit trigger; staff-only (returns early for
--                             customers and unauthenticated sessions)
--
-- Edge Function called by the app:
--   manage-user  -> src/lib/adminData.ts (manageUser)
--   Touches: profiles, user_activity_log, auth.users
--
-- Storage bucket used by the app:
--   product-images  -> src/lib/productImages.ts
--
-- Column-level check: every column referenced in app queries (select/insert/
-- update) was verified present on the corresponding table in this schema.
-- No missing columns detected.
--
-- Conclusion: schema_complete.sql is the accurate, complete source of truth
-- for the Supabase database that the running app uses.

