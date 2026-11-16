-- SUPERSEDED — DO NOT RUN ON NEW INSTALLS.
-- This migration introduces the department-based role model ('Customer', 'Staff',
-- 'Manager', 'Super Admin') that the current frontend, seed_1000.sql, and the
-- manage-user Edge Function do not use. Use pdf_rbac.sql instead; it restores the
-- lowercase roles the app expects and reverts this department model.
-- Kept only as a reference when rolling back an older installation.

-- Run after schema.sql and order_fix_update.sql.
alter table public.profiles
  add column if not exists employee_id text,
  add column if not exists position text not null default '',
  add column if not exists department text not null default '',
  add column if not exists account_status text not null default 'Active',
  add column if not exists module_permissions jsonb not null default '{}'::jsonb;

create table if not exists public.departments (
  name text primary key,
  active boolean not null default true
);
insert into public.departments (name)
select distinct btrim(department) from public.profiles
where role not in ('Customer', 'Super Admin') and nullif(btrim(department), '') is not null
on conflict (name) do nothing;
insert into public.departments (name) values ('Bacolod'), ('Iloilo')
on conflict (name) do nothing;
alter table public.departments enable row level security;
drop policy if exists departments_active_select on public.departments;
create policy departments_active_select on public.departments for select to authenticated using (active);
grant select on public.departments to authenticated;
revoke insert, update, delete on public.departments from anon, authenticated;

create table if not exists public.department_city_mappings (
  city text primary key,
  department text not null references public.departments(name),
  check (city = lower(btrim(city)))
);
-- ponytail: use explicit city routing; free-text addresses cannot reliably identify the nearest branch.
insert into public.department_city_mappings (city, department) values
  ('bacolod', 'Bacolod'), ('bacolod city', 'Bacolod'),
  ('iloilo', 'Iloilo'), ('iloilo city', 'Iloilo')
on conflict (city) do update set department = excluded.department;
alter table public.department_city_mappings enable row level security;
drop policy if exists department_city_mappings_public_select on public.department_city_mappings;
create policy department_city_mappings_public_select on public.department_city_mappings
  for select to anon, authenticated using (true);
grant select on public.department_city_mappings to anon, authenticated;

alter table public.inventory add column if not exists department text references public.departments(name);
alter table public.orders add column if not exists department text references public.departments(name);
alter table public.inventory_movements add column if not exists department text references public.departments(name);
alter table public.inventory drop constraint if exists inventory_variant_id_key;
create unique index if not exists inventory_variant_department_idx
  on public.inventory(variant_id, (coalesce(department, '')));
create index if not exists orders_department_created_at_idx on public.orders(department, created_at desc);
create index if not exists inventory_movements_department_idx on public.inventory_movements(department);

insert into public.inventory (variant_id, department, stock_quantity, reorder_level)
select v.id, d.name, 0, 10
from public.product_variants v cross join public.departments d
where d.active
on conflict (variant_id, (coalesce(department, ''))) do nothing;

create or replace function public.initialize_department_inventory()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.inventory (variant_id, department, stock_quantity, reorder_level)
  select new.id, d.name, 0, 10 from public.departments d where d.active
  on conflict (variant_id, (coalesce(department, ''))) do nothing;
  return new;
end;
$$;
drop trigger if exists initialize_department_inventory on public.product_variants;
create trigger initialize_department_inventory after insert on public.product_variants
for each row execute function public.initialize_department_inventory();

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'Manager' where role = 'Beauty Admin';
update public.profiles set role = 'Staff' where role = 'Beauty Staff';
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Customer', 'Staff', 'Employee', 'Manager', 'Super Admin'));

alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('Active', 'Inactive'));

create sequence if not exists public.employee_id_seq;
do $$
declare
  v_next_id bigint;
  v_last_id bigint;
  v_is_called boolean;
begin
  select coalesce(max(substring(employee_id from 5)::bigint), 0) + 1
  into v_next_id
  from public.profiles
  where employee_id ~ '^EMP-[0-9]+$';
  select last_value, is_called into v_last_id, v_is_called from public.employee_id_seq;
  if not v_is_called or v_last_id < v_next_id then
    perform setval('public.employee_id_seq', v_next_id, false);
  end if;
end;
$$;

create or replace function public.assign_employee_id()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.role = 'Customer' then
    new.employee_id := null;
    new.position := '';
    new.department := '';
    new.module_permissions := '{}'::jsonb;
  elsif new.role = 'Super Admin' then
    new.department := '';
  elsif new.employee_id is null or new.employee_id = '' then
    new.employee_id := 'EMP-' || lpad(nextval('public.employee_id_seq')::text, 6, '0');
  end if;
  if new.role not in ('Customer', 'Super Admin') then
    new.department := btrim(coalesce(new.department, ''));
    if new.department = '' or not exists (
      select 1 from public.departments where name = new.department and active
    ) then
      raise exception 'An active department is required for employee accounts';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_employee_id on public.profiles;
create trigger assign_employee_id
before insert or update of role, department on public.profiles
for each row execute function public.assign_employee_id();
update public.profiles set department = '' where role = 'Super Admin' and department <> '';

update public.profiles
set employee_id = 'EMP-' || lpad(nextval('public.employee_id_seq')::text, 6, '0')
where role <> 'Customer' and (employee_id is null or employee_id = '');

create unique index if not exists profiles_employee_id_idx
  on public.profiles(employee_id) where employee_id is not null;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'Active'
  );
$$;

create or replace function public.is_active_customer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'Customer' and account_status = 'Active'
  );
$$;

create or replace function public.has_permission(p_module text, p_action text default 'view')
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when p.account_status <> 'Active' then false
      when p.role = 'Super Admin' then true
      when p.role = 'Manager' then case p_module
        when 'dashboard' then p_action = 'view'
        when 'products' then p_action = 'view'
        when 'inventory' then p_action = any(array['view', 'create', 'edit', 'manage'])
        when 'customers' then p_action = 'view'
        when 'sales' then p_action = any(array['view', 'manage'])
        when 'reports' then p_action = any(array['view', 'generate', 'export'])
        when 'employees' then p_action = any(array['view', 'manage'])
        else false
      end
      when p.role in ('Employee', 'Staff') then
        coalesce((p.module_permissions -> p_module) ? p_action, false)
      else false
    end
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.can_access_department(p_department text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.account_status = 'Active'
      and (
        p.role = 'Super Admin'
        or (p.role in ('Manager', 'Employee', 'Staff')
          and nullif(p_department, '') is not null
          and p.department = p_department)
      )
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'Super Admin' and account_status = 'Active'
  );
$$;

create table if not exists public.employee_audit_log (
  id bigint generated by default as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists employee_audit_log_created_at_idx
  on public.employee_audit_log(created_at desc);
create index if not exists employee_audit_log_actor_id_idx
  on public.employee_audit_log(actor_id);
alter table public.employee_audit_log enable row level security;
drop policy if exists employee_audit_log_super_admin_select on public.employee_audit_log;
create policy employee_audit_log_super_admin_select on public.employee_audit_log
  for select to authenticated using (public.has_permission('audit', 'view'));
revoke all on public.employee_audit_log from anon, authenticated;
grant select on public.employee_audit_log to authenticated;
grant select, insert on public.employee_audit_log to service_role;
grant usage, select on sequence public.employee_audit_log_id_seq to service_role;

create or replace function public.audit_employee_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_record jsonb;
begin
  if auth.uid() is not null and exists (
    select 1 from public.profiles
    where id = auth.uid() and role <> 'Customer' and account_status = 'Active'
  ) then
    v_record := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    insert into public.employee_audit_log (actor_id, action, details)
    values (
      auth.uid(),
      lower(tg_table_name) || '.' || lower(tg_op),
      jsonb_build_object('table', tg_table_name, 'record_id', v_record ->> 'id')
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
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
    'payments', 'recommendation_rules', 'support_inquiries', 'support_responses'
  ] loop
    execute format('drop trigger if exists audit_employee_activity on public.%I', v_table);
    execute format(
      'create trigger audit_employee_activity after insert or update or delete on public.%I for each row execute function public.audit_employee_activity()',
      v_table
    );
  end loop;
end;
$$;

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
begin
  if not public.has_permission('inventory', 'manage') then raise exception 'Inventory management access required'; end if;
  if p_movement_type not in ('Stock In', 'Stock Out') then raise exception 'Invalid movement type'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;

  select * into v_inventory from public.inventory where id = p_inventory_id for update;
  if not found then raise exception 'Inventory row not found'; end if;
  if not public.can_access_department(v_inventory.department) then
    raise exception 'Inventory belongs to another department';
  end if;
  v_next_stock := case when p_movement_type = 'Stock In' then v_inventory.stock_quantity + p_quantity else v_inventory.stock_quantity - p_quantity end;
  if v_next_stock < 0 then raise exception 'Insufficient stock'; end if;

  update public.inventory set stock_quantity = v_next_stock, updated_at = now() where id = p_inventory_id;
  insert into public.inventory_movements (variant_id, department, movement_type, quantity, reference, notes, created_by)
  values (v_inventory.variant_id, v_inventory.department, p_movement_type, p_quantity, p_reference, p_notes, auth.uid())
  returning * into v_movement;
  return v_movement;
end;
$$;

create or replace function public.transfer_central_inventory(
  p_variant_id uuid,
  p_department text,
  p_quantity integer
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_source public.inventory;
  v_target public.inventory;
  v_reference text := 'TRANSFER-' || gen_random_uuid()::text;
begin
  if not public.is_admin() then raise exception 'Super Administrator access required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  if not exists (select 1 from public.departments where name = p_department and active) then
    raise exception 'Target department is not active';
  end if;

  select * into v_source from public.inventory
  where variant_id = p_variant_id and department is null for update;
  if not found then raise exception 'Central inventory row not found'; end if;
  if v_source.stock_quantity < p_quantity then raise exception 'Insufficient central stock'; end if;

  insert into public.inventory (variant_id, department, stock_quantity, reorder_level)
  values (p_variant_id, p_department, 0, v_source.reorder_level)
  on conflict (variant_id, (coalesce(department, ''))) do nothing;
  select * into v_target from public.inventory
  where variant_id = p_variant_id and department = p_department for update;

  update public.inventory set stock_quantity = stock_quantity - p_quantity, updated_at = now()
  where id = v_source.id;
  update public.inventory set stock_quantity = stock_quantity + p_quantity, updated_at = now()
  where id = v_target.id;
  insert into public.inventory_movements (variant_id, department, movement_type, quantity, reference, notes, created_by)
  values
    (p_variant_id, null, 'Stock Out', p_quantity, v_reference, 'Transferred to ' || p_department, auth.uid()),
    (p_variant_id, p_department, 'Stock In', p_quantity, v_reference, 'Transferred from central inventory', auth.uid());
end;
$$;

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
  v_department text;
begin
  if p_user_id <> auth.uid() or not public.is_active_customer() then
    raise exception 'Active customer access required';
  end if;

  select m.department into v_department
  from public.department_city_mappings m
  join public.departments d on d.name = m.department and d.active
  where m.city = lower(btrim(p_shipping_city));
  if v_department is null then
    raise exception 'No delivery branch is configured for this shipping city';
  end if;

  insert into public.orders (user_id, department, total_amount, subtotal, shipping_fee, tax, payment_method, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, shipping_zip, shipping_country)
  values (p_user_id, v_department, p_total_amount, p_subtotal, p_shipping_fee, p_tax, p_payment_method, p_shipping_name, p_shipping_email, p_shipping_phone, p_shipping_address, p_shipping_city, p_shipping_zip, p_shipping_country)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_inventory from public.inventory
    where variant_id = (v_item ->> 'variant_id')::uuid and department = v_department for update;
    if not found then raise exception 'This product is not stocked at the assigned branch'; end if;
    if v_inventory.stock_quantity < (v_item ->> 'quantity')::integer then raise exception 'Insufficient stock'; end if;
    insert into public.order_items (order_id, variant_id, quantity, price_at_purchase)
    values (v_order.id, (v_item ->> 'variant_id')::uuid, (v_item ->> 'quantity')::integer, (v_item ->> 'price_at_purchase')::numeric);
    update public.inventory set stock_quantity = stock_quantity - (v_item ->> 'quantity')::integer, updated_at = now() where id = v_inventory.id;
    insert into public.inventory_movements (variant_id, department, movement_type, quantity, reference, order_id)
    values ((v_item ->> 'variant_id')::uuid, v_department, 'Stock Out', (v_item ->> 'quantity')::integer, v_order.id::text, v_order.id);
  end loop;
  insert into public.payments (order_id, provider, status, amount)
  values (v_order.id, case when p_payment_method = 'cash_on_delivery' then 'Cash on Delivery' else 'Stripe' end, 'Pending', p_total_amount);
  return v_order;
end;
$$;

alter table public.profiles enable row level security;
drop policy if exists profiles_self_or_admin on public.profiles;
drop policy if exists profiles_scoped_select on public.profiles;
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_scoped_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.has_permission('users', 'view')
  or (role in ('Manager', 'Employee', 'Staff')
    and public.has_permission('employees', 'view')
    and public.can_access_department(department))
  or (role = 'Customer' and public.has_permission('customers', 'view') and exists (
    select 1 from public.orders o
    where o.user_id = public.profiles.id and public.can_access_department(o.department)
  ))
);
create policy profiles_owner_update on public.profiles for update to authenticated
using (id = auth.uid() and public.is_active_user())
with check (id = auth.uid() and public.is_active_user());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, birthday, skin_profile) on public.profiles to authenticated;

drop policy if exists public_active_products on public.products;
drop policy if exists public_active_variants on public.product_variants;
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
drop policy if exists admin_movements on public.inventory_movements;
drop policy if exists own_order_payment_insert on public.payments;
drop policy if exists own_order_movement_insert on public.inventory_movements;
drop policy if exists products_create on public.products;
drop policy if exists products_edit on public.products;
drop policy if exists products_delete on public.products;
drop policy if exists variants_create on public.product_variants;
drop policy if exists variants_edit on public.product_variants;
drop policy if exists variants_delete on public.product_variants;
drop policy if exists brands_manage on public.brands;
drop policy if exists brands_edit on public.brands;
drop policy if exists brands_delete on public.brands;
drop policy if exists categories_manage on public.categories;
drop policy if exists categories_edit on public.categories;
drop policy if exists categories_delete on public.categories;
drop policy if exists inventory_create on public.inventory;
drop policy if exists inventory_edit on public.inventory;
drop policy if exists inventory_delete on public.inventory;
drop policy if exists suppliers_select on public.suppliers;
drop policy if exists suppliers_create on public.suppliers;
drop policy if exists suppliers_edit on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;
drop policy if exists supplier_products_select on public.supplier_products;
drop policy if exists supplier_products_create on public.supplier_products;
drop policy if exists supplier_products_edit on public.supplier_products;
drop policy if exists supplier_products_delete on public.supplier_products;
drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_create on public.purchase_orders;
drop policy if exists purchase_orders_edit on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;
drop policy if exists purchase_items_select on public.purchase_order_items;
drop policy if exists purchase_items_create on public.purchase_order_items;
drop policy if exists purchase_items_edit on public.purchase_order_items;
drop policy if exists purchase_items_delete on public.purchase_order_items;
drop policy if exists own_orders_or_employee on public.orders;
drop policy if exists employee_orders_edit on public.orders;
drop policy if exists own_order_items_or_employee on public.order_items;
drop policy if exists recommendation_manage on public.recommendation_rules;
drop policy if exists payment_manage on public.payments;
drop policy if exists payment_create on public.payments;
drop policy if exists payment_edit on public.payments;
drop policy if exists payment_delete on public.payments;
drop policy if exists inventory_movements_select on public.inventory_movements;

create policy public_active_products on public.products for select
using (status = 'Active' or public.has_permission('products', 'view'));
create policy public_active_variants on public.product_variants for select
using (exists (
  select 1 from public.products p
  where p.id = product_id and (p.status = 'Active' or public.has_permission('products', 'view'))
));
create policy public_inventory on public.inventory for select
using (
  auth.uid() is null
  or public.is_active_customer()
  or (public.has_permission('inventory', 'view') and public.can_access_department(department))
);

drop policy if exists public_brands on public.brands;
drop policy if exists public_categories on public.categories;
create policy public_brands on public.brands for select using (true);
create policy public_categories on public.categories for select using (true);

create policy products_create on public.products for insert to authenticated
with check (public.has_permission('products', 'create'));
create policy products_edit on public.products for update to authenticated
using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy products_delete on public.products for delete to authenticated
using (public.has_permission('products', 'delete'));
create policy variants_create on public.product_variants for insert to authenticated
with check (public.has_permission('products', 'create'));
create policy variants_edit on public.product_variants for update to authenticated
using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy variants_delete on public.product_variants for delete to authenticated
using (public.has_permission('products', 'delete'));
create policy brands_manage on public.brands for insert to authenticated
with check (public.has_permission('products', 'edit'));
create policy brands_edit on public.brands for update to authenticated
using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy brands_delete on public.brands for delete to authenticated
using (public.has_permission('products', 'delete'));
create policy categories_manage on public.categories for insert to authenticated
with check (public.has_permission('products', 'edit'));
create policy categories_edit on public.categories for update to authenticated
using (public.has_permission('products', 'edit')) with check (public.has_permission('products', 'edit'));
create policy categories_delete on public.categories for delete to authenticated
using (public.has_permission('products', 'delete'));

create policy inventory_create on public.inventory for insert to authenticated
with check (public.has_permission('inventory', 'create') and public.can_access_department(department));
create policy inventory_edit on public.inventory for update to authenticated
using (public.has_permission('inventory', 'edit') and public.can_access_department(department))
with check (public.has_permission('inventory', 'edit') and public.can_access_department(department));
create policy inventory_delete on public.inventory for delete to authenticated
using (public.has_permission('inventory', 'delete') and public.can_access_department(department));

create policy suppliers_select on public.suppliers for select to authenticated
using (public.has_permission('suppliers', 'view'));
create policy suppliers_create on public.suppliers for insert to authenticated
with check (public.has_permission('suppliers', 'create'));
create policy suppliers_edit on public.suppliers for update to authenticated
using (public.has_permission('suppliers', 'edit')) with check (public.has_permission('suppliers', 'edit'));
create policy suppliers_delete on public.suppliers for delete to authenticated
using (public.has_permission('suppliers', 'delete'));
create policy supplier_products_select on public.supplier_products for select to authenticated
using (public.has_permission('suppliers', 'view'));
create policy supplier_products_create on public.supplier_products for insert to authenticated
with check (public.has_permission('suppliers', 'create'));
create policy supplier_products_edit on public.supplier_products for update to authenticated
using (public.has_permission('suppliers', 'edit')) with check (public.has_permission('suppliers', 'edit'));
create policy supplier_products_delete on public.supplier_products for delete to authenticated
using (public.has_permission('suppliers', 'edit'));

create policy purchase_orders_select on public.purchase_orders for select to authenticated
using (public.has_permission('purchases', 'view'));
create policy purchase_orders_create on public.purchase_orders for insert to authenticated
with check (public.has_permission('purchases', 'create'));
create policy purchase_orders_edit on public.purchase_orders for update to authenticated
using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));
create policy purchase_orders_delete on public.purchase_orders for delete to authenticated
using (public.has_permission('purchases', 'delete'));
create policy purchase_items_select on public.purchase_order_items for select to authenticated
using (public.has_permission('purchases', 'view'));
create policy purchase_items_create on public.purchase_order_items for insert to authenticated
with check (public.has_permission('purchases', 'create'));
create policy purchase_items_edit on public.purchase_order_items for update to authenticated
using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));
create policy purchase_items_delete on public.purchase_order_items for delete to authenticated
using (public.has_permission('purchases', 'delete'));

create policy own_orders_or_employee on public.orders for select
using (
  (user_id = auth.uid() and public.is_active_customer())
  or ((public.has_permission('purchases', 'view') or public.has_permission('sales', 'view'))
    and public.can_access_department(department))
);
create policy create_own_orders on public.orders for insert to authenticated
with check (user_id = auth.uid() and public.is_active_customer());
create policy employee_orders_edit on public.orders for update to authenticated
using ((public.has_permission('purchases', 'manage') or public.has_permission('sales', 'manage'))
  and public.can_access_department(department))
with check ((public.has_permission('purchases', 'manage') or public.has_permission('sales', 'manage'))
  and public.can_access_department(department));
create policy own_order_items_or_employee on public.order_items for select
using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid() and public.is_active_customer())
  or exists (
    select 1 from public.orders o
    where o.id = order_id
      and (public.has_permission('purchases', 'view') or public.has_permission('sales', 'view'))
      and public.can_access_department(o.department)
  )
);
create policy create_own_order_items on public.order_items for insert to authenticated
with check (exists (
  select 1 from public.orders o
  where o.id = order_id and o.user_id = auth.uid() and public.is_active_customer()
));

create policy recommendation_read on public.recommendation_rules for select
using (
  is_active and (auth.uid() is null or public.is_active_customer())
  or public.has_permission('recommendations', 'view')
);
create policy recommendation_manage on public.recommendation_rules for all to authenticated
using (public.has_permission('recommendations', 'manage'))
with check (public.has_permission('recommendations', 'manage'));

create policy own_payments on public.payments for select
using (
  exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid() and public.is_active_customer())
  or exists (
    select 1 from public.orders o
    where o.id = order_id
      and (public.has_permission('sales', 'view') or public.has_permission('purchases', 'view'))
      and public.can_access_department(o.department)
  )
);
create policy payment_create on public.payments for insert to authenticated
with check (public.has_permission('sales', 'manage'));
create policy payment_edit on public.payments for update to authenticated
using (public.has_permission('sales', 'manage')) with check (public.has_permission('sales', 'manage'));
create policy payment_delete on public.payments for delete to authenticated
using (public.has_permission('sales', 'delete'));
create policy own_order_payment_insert on public.payments for insert to authenticated
with check (exists (
  select 1 from public.orders o
  where o.id = order_id and o.user_id = auth.uid() and public.is_active_customer()
));
create policy inventory_movements_select on public.inventory_movements for select to authenticated
using (public.has_permission('inventory', 'view') and public.can_access_department(department));

drop policy if exists own_cart_items on public.cart_items;
create policy own_cart_items on public.cart_items for all
using (user_id = auth.uid() and public.is_active_customer())
with check (user_id = auth.uid() and public.is_active_customer());
drop policy if exists own_wishlist_items on public.wishlist_items;
create policy own_wishlist_items on public.wishlist_items for all
using (user_id = auth.uid() and public.is_active_customer())
with check (user_id = auth.uid() and public.is_active_customer());
drop policy if exists own_user_addresses on public.user_addresses;
create policy own_user_addresses on public.user_addresses for all
using (user_id = auth.uid() and public.is_active_customer())
with check (user_id = auth.uid() and public.is_active_customer());
drop policy if exists own_user_payment_methods on public.user_payment_methods;
create policy own_user_payment_methods on public.user_payment_methods for all
using (user_id = auth.uid() and public.is_active_customer())
with check (user_id = auth.uid() and public.is_active_customer());

drop policy if exists support_inquiries_admin_select on public.support_inquiries;
drop policy if exists support_inquiries_customer_select on public.support_inquiries;
drop policy if exists support_inquiries_admin_update on public.support_inquiries;
drop policy if exists support_inquiries_public_insert on public.support_inquiries;
drop policy if exists support_responses_admin_select on public.support_responses;
drop policy if exists support_responses_admin_insert on public.support_responses;
drop policy if exists support_inquiries_employee_select on public.support_inquiries;
drop policy if exists support_inquiries_employee_update on public.support_inquiries;
drop policy if exists support_responses_employee_select on public.support_responses;
drop policy if exists support_responses_employee_insert on public.support_responses;
create policy support_inquiries_employee_select on public.support_inquiries for select to authenticated
using (
  public.has_permission('support', 'view')
  or (user_id = auth.uid() and public.is_active_customer())
  or (user_id is null and public.is_active_customer() and lower(email) = lower(auth.jwt() ->> 'email'))
);
create policy support_inquiries_public_insert on public.support_inquiries for insert to anon, authenticated
with check (
  status = 'Open' and coalesce(support_reply, '') = ''
  and (
    (auth.uid() is null and user_id is null)
    or (public.is_active_customer() and (user_id = auth.uid() or user_id is null))
  )
);
create policy support_inquiries_employee_update on public.support_inquiries for update to authenticated
using (public.has_permission('support', 'respond'))
with check (public.has_permission('support', 'respond'));
revoke update on public.support_inquiries from authenticated;
grant update (status, sentiment, last_reply, support_reply) on public.support_inquiries to authenticated;
create policy support_responses_employee_select on public.support_responses for select to authenticated
using (public.has_permission('support', 'view'));
create policy support_responses_employee_insert on public.support_responses for insert to authenticated
with check (public.has_permission('support', 'respond'));

drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_insert on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.has_permission('products', 'create'));
create policy product_images_admin_delete on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (public.has_permission('products', 'edit') or public.has_permission('products', 'delete')));

grant execute on function public.record_inventory_movement(uuid, text, integer, text, text) to authenticated;
grant execute on function public.transfer_central_inventory(uuid, text, integer) to authenticated;
revoke insert on public.orders, public.order_items from authenticated;

create or replace view public.product_sales with (security_invoker = true) as
with sales as (
  select v.product_id, o.department,
    sum(case when o.status <> 'Cancelled' then oi.quantity else 0 end)::integer as units_sold,
    sum(case when o.status <> 'Cancelled' then oi.quantity * oi.price_at_purchase else 0 end) as revenue
  from public.order_items oi
  join public.product_variants v on v.id = oi.variant_id
  join public.orders o on o.id = oi.order_id
  group by v.product_id, o.department
), stock as (
  select v.product_id, i.department, sum(i.stock_quantity)::integer as units,
    min(i.reorder_level)::integer as reorder_level
  from public.inventory i join public.product_variants v on v.id = i.variant_id
  group by v.product_id, i.department
), product_departments as (
  select d.name as department, p.id as product_id
  from public.departments d cross join public.products p where d.active
  union
  select null::text, p.id from public.products p
)
select p.id, p.name, p.category_id,
  coalesce(s.units_sold, 0)::integer as units_sold,
  coalesce(s.revenue, 0) as revenue,
  coalesce(st.units, 0)::integer as stock,
  coalesce(st.reorder_level, 10)::integer as reorder_level,
  c.name as category_name,
  pd.department
from product_departments pd
join public.products p on p.id = pd.product_id
left join public.categories c on c.id = p.category_id
left join sales s on s.product_id = p.id and s.department is not distinct from pd.department
left join stock st on st.product_id = p.id and st.department is not distinct from pd.department
where public.can_access_department(pd.department);

create or replace view public.sales_by_month with (security_invoker = true) as
select date_trunc('month', o.created_at) as month_date,
       to_char(date_trunc('month', o.created_at), 'Mon YYYY') as month,
       coalesce(sum(o.total_amount), 0) as sales,
       count(*)::integer as orders,
       o.department
from public.orders o
where o.status <> 'Cancelled' and public.can_access_department(o.department)
group by 1, o.department
order by 1;

grant select on public.product_sales, public.sales_by_month to authenticated;
