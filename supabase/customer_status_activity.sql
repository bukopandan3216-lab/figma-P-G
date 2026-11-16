begin;

alter table public.profiles
  add column if not exists account_status text not null default 'Active',
  add column if not exists last_seen_at timestamptz;

update public.profiles set account_status = 'Active' where account_status is null;
alter table public.profiles alter column account_status set default 'Active';
alter table public.profiles alter column account_status set not null;
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('Active', 'Inactive'));

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and account_status = 'Active'
  );
$$;

create or replace function public.is_customer()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'customer' and account_status = 'Active'
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
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.touch_user_activity()
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_last_seen timestamptz;
begin
  select role, last_seen_at into v_role, v_last_seen
  from public.profiles
  where id = auth.uid() and account_status = 'Active';

  if not found then return; end if;

  update public.profiles set last_seen_at = now() where id = auth.uid();
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
  select a.id::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Unknown user'),
    coalesce(p.role, a.details ->> 'role', 'Unknown role'),
    a.action, a.details, a.created_at
  from public.user_activity_log a
  left join public.profiles p on p.id = a.actor_id
  where p.role in ('super_admin', 'beauty_admin', 'beauty_staff')
  order by a.created_at desc
  limit 250;
end;
$$;

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
  select a.id::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), a.action, a.details, a.created_at
  from public.user_activity_log a
  join public.profiles p on p.id = a.actor_id
  where p.role = 'customer' and a.action = 'session.active'

  union all

  select i.id::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''),
    'product.' || i.interaction_type,
    jsonb_build_object('product_id', i.product_id, 'product', pr.name, 'recommendation_id', i.recommendation_id),
    i.created_at
  from public.customer_product_interactions i
  join public.profiles p on p.id = i.user_id
  left join public.products pr on pr.id = i.product_id

  union all

  select o.id::text,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'Customer'),
    coalesce(p.email, ''), 'order.placed',
    jsonb_build_object('order_no', o.order_no, 'status', o.status, 'total_amount', o.total_amount),
    o.created_at
  from public.orders o
  join public.profiles p on p.id = o.user_id
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
  where id = p_user_id
  for update;

  if not found or v_role <> 'customer' then
    raise exception 'Customer account not found';
  end if;
  if v_previous_status = p_status then return; end if;

  update public.profiles set account_status = p_status where id = p_user_id;
  insert into public.user_activity_log (actor_id, action, details)
  values (
    auth.uid(),
    'customer.status_changed',
    jsonb_build_object('user_id', p_user_id, 'previous_status', v_previous_status, 'status', p_status)
  );
end;
$$;

drop policy if exists user_activity_admin_select on public.user_activity_log;
drop policy if exists user_activity_super_admin_select on public.user_activity_log;
create policy user_activity_admin_select on public.user_activity_log for select to authenticated
using (public.has_permission('activity', 'view'));

grant execute on function public.touch_user_activity() to authenticated;
grant execute on function public.touch_customer_activity() to authenticated;
grant execute on function public.get_staff_activity() to authenticated;
grant execute on function public.get_customer_activity() to authenticated;
revoke all on function public.set_customer_account_status(uuid, text) from public, anon;
grant execute on function public.set_customer_account_status(uuid, text) to authenticated;

grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant insert on public.user_activity_log to service_role;
grant usage, select on sequence public.user_activity_log_id_seq to service_role;

commit;
