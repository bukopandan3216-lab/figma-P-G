-- Run after schema.sql, relationship_fix.sql, and order_fix_update.sql.
begin;

drop view if exists public.product_sales;
drop view if exists public.sales_by_month;
drop view if exists public.underperforming_products;

drop function if exists public.can_access_department(text) cascade;
drop function if exists public.transfer_central_inventory(uuid, text, integer) cascade;
drop function if exists public.initialize_department_inventory() cascade;
drop function if exists public.assign_employee_id() cascade;

drop trigger if exists initialize_department_inventory on public.product_variants;
drop trigger if exists assign_employee_id on public.profiles;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles', 'brands', 'categories', 'products', 'product_variants', 'inventory',
        'suppliers', 'purchase_orders', 'purchase_order_items',
        'orders', 'order_items', 'payments', 'inventory_movements', 'recommendation_rules',
        'recommendations', 'customer_product_interactions', 'user_activity_log',
        'cart_items', 'wishlist_items', 'user_addresses', 'user_payment_methods',
        'support_inquiries', 'support_responses', 'employee_audit_log'
      ])
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists account_status text not null default 'Active';
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('Active', 'Inactive'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'full_name'
  ) then
    execute $q$
      update public.profiles
      set first_name = coalesce(nullif(first_name, ''), split_part(btrim(full_name), ' ', 1), ''),
          last_name = coalesce(nullif(last_name, ''), nullif(regexp_replace(btrim(full_name), '^\S+\s*', ''), ''), '')
    $q$;
  end if;
end;
$$;

update public.profiles
set role = case lower(role)
  when 'customer' then 'customer'
  when 'beauty staff' then 'beauty_staff'
  when 'staff' then 'beauty_staff'
  when 'beauty_staff' then 'beauty_staff'
  when 'beauty admin' then 'beauty_admin'
  when 'manager' then 'beauty_admin'
  when 'beauty_admin' then 'beauty_admin'
  when 'super admin' then 'super_admin'
  when 'super_admin' then 'super_admin'
  else role
end;

alter table public.profiles alter column role set default 'customer';
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer', 'beauty_staff', 'beauty_admin', 'super_admin'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory' and column_name = 'department'
  ) then
    execute $q$
      with totals as (
        select variant_id, sum(stock_quantity)::integer as stock_quantity,
          min(reorder_level)::integer as reorder_level
        from public.inventory group by variant_id
      )
      update public.inventory i
      set stock_quantity = totals.stock_quantity,
          reorder_level = totals.reorder_level,
          updated_at = now()
      from totals
      where i.variant_id = totals.variant_id and i.department is null
    $q$;
    execute $q$
      insert into public.inventory (variant_id, stock_quantity, reorder_level)
      select totals.variant_id, totals.stock_quantity, totals.reorder_level
      from (
        select variant_id, sum(stock_quantity)::integer as stock_quantity,
          min(reorder_level)::integer as reorder_level
        from public.inventory group by variant_id
      ) totals
      where not exists (select 1 from public.inventory i where i.variant_id = totals.variant_id and i.department is null)
    $q$;
    execute 'delete from public.inventory where department is not null';
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'inventory'
        and c.relkind = 'r'
    ) then
      execute 'alter table public.inventory drop column department';
    end if;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'department'
  ) then
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'orders'
        and c.relkind = 'r'
    ) then
      execute 'alter table public.orders drop column department';
    end if;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'department'
  ) then
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'inventory_movements'
        and c.relkind = 'r'
    ) then
      execute 'alter table public.inventory_movements drop column department';
    end if;
  end if;
end;
$$;

drop index if exists public.inventory_variant_department_idx;
create unique index if not exists inventory_variant_id_unique_idx on public.inventory(variant_id);
drop index if exists public.orders_department_created_at_idx;
drop index if exists public.inventory_movements_department_idx;
drop table if exists public.department_city_mappings cascade;
drop table if exists public.departments cascade;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and c.relkind = 'r'
  ) then
    execute $q$
      alter table public.profiles
        drop column if exists full_name,
        drop column if exists employee_id,
        drop column if exists position,
        drop column if exists department,
        drop column if exists module_permissions
    $q$;
  end if;
end;
$$;

drop sequence if exists public.employee_id_seq;

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  score numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.customer_product_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  recommendation_id uuid references public.recommendations(id) on delete set null,
  interaction_type text not null check (interaction_type in ('view', 'recommendation_shown', 'recommendation_clicked', 'cart', 'wishlist', 'purchase')),
  created_at timestamptz not null default now()
);
create table if not exists public.user_activity_log (
  id bigint generated by default as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.employee_audit_log') is not null then
    execute $q$
      insert into public.user_activity_log (actor_id, action, details, created_at)
      select actor_id, action, details, created_at from public.employee_audit_log
    $q$;
    execute 'drop table public.employee_audit_log cascade';
  end if;
end;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and account_status = 'Active');
$$;

create or replace function public.is_customer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'customer' and account_status = 'Active');
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
      when 'beauty_staff' then (p_module = 'inventory' and p_action = any(array['view', 'manage']))
        or (p_module = 'activity' and p_action = 'view')
      else false
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, email, skin_profile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data -> 'skin_profile', '{}'::jsonb)
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function public.record_inventory_movement(
  p_inventory_id uuid, p_movement_type text, p_quantity integer,
  p_reference text default null, p_notes text default null
) returns public.inventory_movements
language plpgsql security definer set search_path = public
as $$
declare
  v_inventory public.inventory;
  v_movement public.inventory_movements;
  v_next_stock integer;
begin
  if not public.has_permission('inventory', 'manage') then raise exception 'Inventory access required'; end if;
  if p_movement_type not in ('Stock In', 'Stock Out') then raise exception 'Invalid movement type'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  select * into v_inventory from public.inventory where id = p_inventory_id for update;
  if not found then raise exception 'Inventory row not found'; end if;
  v_next_stock := case when p_movement_type = 'Stock In' then v_inventory.stock_quantity + p_quantity else v_inventory.stock_quantity - p_quantity end;
  if v_next_stock < 0 then raise exception 'Insufficient stock'; end if;
  update public.inventory set stock_quantity = v_next_stock, updated_at = now() where id = p_inventory_id;
  insert into public.inventory_movements (variant_id, movement_type, quantity, reference, notes, created_by)
  values (v_inventory.variant_id, p_movement_type, p_quantity, p_reference, p_notes, auth.uid())
  returning * into v_movement;
  return v_movement;
end;
$$;

create or replace function public.audit_user_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_record jsonb;
  v_profile public.profiles;
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
    and (to_jsonb(old) - 'last_seen_at') = (to_jsonb(new) - 'last_seen_at') then
    return new;
  end if;

  if auth.uid() is not null then
    select * into v_profile from public.profiles where id = auth.uid();
    v_record := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    insert into public.user_activity_log (actor_id, action, details)
    values (
      auth.uid(),
      lower(tg_table_name) || '.' || lower(tg_op),
      jsonb_build_object('table', tg_table_name, 'record_id', v_record ->> 'id', 'role', v_profile.role)
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
    'profiles', 'brands', 'categories', 'products', 'product_variants', 'inventory',
    'inventory_movements', 'suppliers', 'purchase_orders',
    'purchase_order_items', 'orders', 'order_items', 'payments', 'recommendations',
    'customer_product_interactions', 'support_inquiries', 'support_responses'
  ] loop
    execute format('drop trigger if exists audit_employee_activity on public.%I', v_table);
    execute format('drop trigger if exists audit_user_activity on public.%I', v_table);
    execute format('create trigger audit_user_activity after insert or update or delete on public.%I for each row execute function public.audit_user_activity()', v_table);
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'brands', 'categories', 'products', 'product_variants', 'inventory',
    'suppliers', 'purchase_orders', 'purchase_order_items',
    'orders', 'order_items', 'payments', 'inventory_movements', 'recommendation_rules',
    'recommendations', 'customer_product_interactions', 'user_activity_log',
    'cart_items', 'wishlist_items', 'user_addresses', 'user_payment_methods',
    'support_inquiries', 'support_responses'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end;
$$;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or (role = 'customer' and public.has_permission('customers', 'view'))
);
create policy profiles_owner_update on public.profiles for update to authenticated
using (id = auth.uid() and public.is_customer())
with check (id = auth.uid() and public.is_customer());

create policy public_active_products on public.products for select
using (status = 'Active' or public.has_permission('products', 'view'));
create policy public_active_variants on public.product_variants for select
using (exists (select 1 from public.products p where p.id = product_id and (p.status = 'Active' or public.has_permission('products', 'view'))));
create policy public_brands on public.brands for select using (true);
create policy public_categories on public.categories for select using (true);
create policy public_inventory on public.inventory for select using (true);

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

create policy inventory_insert on public.inventory for insert to authenticated with check (public.is_admin() or public.has_permission('inventory', 'manage'));
create policy inventory_update on public.inventory for update to authenticated using (public.is_admin() or public.has_permission('inventory', 'manage')) with check (public.is_admin() or public.has_permission('inventory', 'manage'));
create policy inventory_delete on public.inventory for delete to authenticated using (public.is_admin());

create policy suppliers_select on public.suppliers for select to authenticated using (public.has_permission('suppliers', 'view'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.has_permission('suppliers', 'create'));
create policy suppliers_update on public.suppliers for update to authenticated using (public.has_permission('suppliers', 'edit')) with check (public.has_permission('suppliers', 'edit'));
create policy suppliers_delete on public.suppliers for delete to authenticated using (public.has_permission('suppliers', 'delete'));
create policy purchase_orders_select on public.purchase_orders for select to authenticated using (public.has_permission('purchases', 'view'));
create policy purchase_orders_write on public.purchase_orders for all to authenticated using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));
create policy purchase_items_select on public.purchase_order_items for select to authenticated using (public.has_permission('purchases', 'view'));
create policy purchase_items_write on public.purchase_order_items for all to authenticated using (public.has_permission('purchases', 'manage')) with check (public.has_permission('purchases', 'manage'));

create policy orders_select on public.orders for select to authenticated
using ((user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'));
create policy orders_customer_insert on public.orders for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());
create policy orders_admin_update on public.orders for update to authenticated
using (public.has_permission('sales', 'manage')) with check (public.has_permission('sales', 'manage'));
create policy order_items_select on public.order_items for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id and ((o.user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'))));
create policy order_items_customer_insert on public.order_items for insert to authenticated
with check (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid() and public.is_customer()));

create policy payments_select on public.payments for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_id and ((o.user_id = auth.uid() and public.is_customer()) or public.has_permission('sales', 'view'))));
create policy payments_write on public.payments for all to authenticated
using (public.has_permission('sales', 'manage')) with check (public.has_permission('sales', 'manage'));
create policy inventory_movements_select on public.inventory_movements for select to authenticated
using (public.has_permission('inventory', 'view'));
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
with check ((public.has_permission('inventory', 'manage')) or (order_id is not null and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid() and public.is_customer())));

create policy recommendation_rules_select on public.recommendation_rules for select using (is_active or public.has_permission('recommendations', 'view'));
create policy recommendation_rules_manage on public.recommendation_rules for all to authenticated
using (public.is_admin() or public.has_permission('recommendations', 'manage'))
with check (public.is_admin() or public.has_permission('recommendations', 'manage'));
create policy recommendations_owner_select on public.recommendations for select to authenticated
using (
  (user_id = auth.uid() and public.is_customer())
  or public.has_permission('recommendations', 'view')
  or public.has_permission('insights', 'view')
);
create policy recommendations_owner_insert on public.recommendations for insert to authenticated with check (user_id = auth.uid() and public.is_customer());
create policy interactions_owner_select on public.customer_product_interactions for select to authenticated
using (
  (user_id = auth.uid() and public.is_customer())
  or public.has_permission('activity', 'view')
  or public.has_permission('insights', 'view')
);
create policy interactions_owner_insert on public.customer_product_interactions for insert to authenticated with check (user_id = auth.uid() and public.is_customer());
create policy user_activity_admin_select on public.user_activity_log for select to authenticated using (public.has_permission('activity', 'view'));

create policy cart_items_owner on public.cart_items for all to authenticated using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
create policy wishlist_items_owner on public.wishlist_items for all to authenticated using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
-- Staff/admin activity and insights pages read carts and wishlists across customers.
create policy cart_items_staff_select on public.cart_items for select to authenticated
using (public.has_permission('activity', 'view') or public.has_permission('insights', 'view'));
create policy wishlist_items_staff_select on public.wishlist_items for select to authenticated
using (public.has_permission('activity', 'view') or public.has_permission('insights', 'view'));
create policy addresses_owner on public.user_addresses for all to authenticated using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());
create policy payment_methods_owner on public.user_payment_methods for all to authenticated using (user_id = auth.uid() and public.is_customer()) with check (user_id = auth.uid() and public.is_customer());

create policy support_inquiries_select on public.support_inquiries for select to authenticated
using ((user_id = auth.uid() and public.is_customer()) or public.has_permission('support', 'view'));
create policy support_inquiries_customer_insert on public.support_inquiries for insert to authenticated
with check (user_id = auth.uid() and public.is_customer());
create policy support_inquiries_respond on public.support_inquiries for update to authenticated
using (public.has_permission('support', 'respond')) with check (public.has_permission('support', 'respond'));
create policy support_responses_select on public.support_responses for select to authenticated
using (public.has_permission('support', 'view') or exists (select 1 from public.support_inquiries i where i.id = inquiry_id and i.user_id = auth.uid() and public.is_customer()));
create policy support_responses_insert on public.support_responses for insert to authenticated
with check (public.has_permission('support', 'respond'));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, last_name, phone, birthday, skin_profile) on public.profiles to authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.brands, public.categories, public.products, public.product_variants, public.inventory to anon, authenticated;
grant select, insert, update, delete on public.products, public.product_variants, public.inventory to authenticated;
grant select, insert, update, delete on public.brands, public.categories, public.suppliers,
  public.purchase_orders, public.purchase_order_items, public.orders, public.order_items, public.payments,
  public.inventory_movements to authenticated;
grant select on public.recommendation_rules to anon, authenticated;
grant select, insert on public.recommendations, public.customer_product_interactions to authenticated;
grant select on public.user_activity_log to authenticated;
grant select, insert, update, delete on public.cart_items, public.wishlist_items, public.user_addresses, public.user_payment_methods to authenticated;
grant select, insert, update on public.support_inquiries to authenticated;
grant select, insert on public.support_responses to authenticated;
grant execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.record_inventory_movement(uuid, text, integer, text, text) to authenticated;

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
    values (v_order.id, v_variant_id, v_quantity, (v_item ->> 'price_at_purchase')::numeric);
    update public.inventory set stock_quantity = stock_quantity - v_quantity, updated_at = now() where id = v_inventory.id;
    insert into public.inventory_movements (variant_id, movement_type, quantity, reference, order_id)
    values (v_variant_id, 'Stock Out', v_quantity, v_order.id::text, v_order.id);

    select product_id into v_product_id from public.product_variants where id = v_variant_id;
    select recommendation_id into v_recommendation_id
    from public.customer_product_interactions
    where user_id = p_user_id and product_id = v_product_id
      and interaction_type = 'recommendation_clicked'
    order by created_at desc limit 1;
    insert into public.customer_product_interactions (user_id, product_id, recommendation_id, interaction_type)
    values (p_user_id, v_product_id, v_recommendation_id, 'purchase');
  end loop;

  insert into public.payments (order_id, provider, status, amount)
  values (v_order.id, case when p_payment_method = 'cash_on_delivery' then 'Cash on Delivery' else 'Stripe' end, 'Pending', p_total_amount);
  return v_order;
end;
$$;

revoke insert on public.orders, public.order_items, public.payments, public.inventory_movements from authenticated;
grant execute on function public.place_order(uuid, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text) to authenticated;

create or replace view public.product_sales with (security_invoker = true) as
select p.id, p.name, p.category_id,
  coalesce(s.units_sold, 0)::integer as units_sold,
  coalesce(s.revenue, 0) as revenue,
  coalesce(i.stock, 0)::integer as stock,
  coalesce(i.reorder_level, 10)::integer as reorder_level,
  c.name as category_name
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select sum(oi.quantity)::integer as units_sold,
    sum(oi.quantity * oi.price_at_purchase) as revenue
  from public.product_variants v
  join public.order_items oi on oi.variant_id = v.id
  join public.orders o on o.id = oi.order_id
  where v.product_id = p.id and o.status <> 'Cancelled'
) s on true
left join lateral (
  select sum(inv.stock_quantity)::integer as stock, min(inv.reorder_level)::integer as reorder_level
  from public.product_variants v join public.inventory inv on inv.variant_id = v.id
  where v.product_id = p.id
) i on true;

create or replace view public.sales_by_month with (security_invoker = true) as
select date_trunc('month', o.created_at) as month_date,
  to_char(date_trunc('month', o.created_at), 'Mon YYYY') as month,
  coalesce(sum(o.total_amount), 0) as sales,
  count(*)::integer as orders
from public.orders o where o.status <> 'Cancelled'
group by 1 order by 1;

create or replace view public.underperforming_products with (security_invoker = true) as
select p.id, p.name, p.created_at from public.products p
where p.created_at < now() - interval '30 days'
and not exists (
  select 1 from public.order_items oi
  join public.product_variants v on v.id = oi.variant_id
  join public.orders o on o.id = oi.order_id
  where v.product_id = p.id and o.created_at >= now() - interval '30 days' and o.status <> 'Cancelled'
);
grant select on public.product_sales, public.sales_by_month, public.underperforming_products to authenticated;

commit;