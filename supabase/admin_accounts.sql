-- ============================================================================
-- Bootstrap staff accounts + retire legacy test accounts
-- ============================================================================
-- Creates (or repairs) the two MIS staff accounts:
--   beautyadmin@pgbeauty.test  -> beauty_admin
--   beautystaff@pgbeauty.test  -> beauty_staff
-- Both are created directly in auth.users with a confirmed email and a bcrypt
-- password; the on_auth_user_created trigger builds the profile and document
-- number, then this script sets the role.
--
-- Retires the legacy accounts, transferring their history first:
--   admin@pgbeauty.test   24 purchase orders + 82 stock movements -> beautyadmin@
--                         3 seeded customer orders                -> maria.santos@
--                         (so attribution stays a real staff/customer, never
--                          'Unknown staff member' or a non-customer owner)
--   admin2@pgbeauty.test  no dependencies -> deleted
--   1admin@pgbeauty.test  no dependencies -> deleted
--   admin3@pgbeauty.test  stays as the remaining super_admin
--
-- Usage (password is passed at run time, never stored in this file):
--   psql <connection> -v ON_ERROR_STOP=1 -v account_pwd='...' -f supabase/admin_accounts.sql
--
-- Idempotent: every statement is guarded, so re-running is safe (creates are
-- skipped, transfers/deletes become no-ops, audit rows are not duplicated).
-- ============================================================================

begin;

-- 1. auth.users (lower-cased emails; bcrypt password; confirmed so the account
--    can sign in immediately without an invitation email).
with desired(email, first_name, last_name) as (
  values ('beautyadmin@pgbeauty.test', 'Beauty', 'Admin'),
         ('beautystaff@pgbeauty.test', 'Beauty', 'Staff')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_sent_at, confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  d.email,
  extensions.crypt(:'account_pwd', extensions.gen_salt('bf')),
  now(), now(), '', '', '', '', '', now(), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('first_name', d.first_name, 'last_name', d.last_name),
  false, false
from desired d
where not exists (select 1 from auth.users u where u.email = d.email);

-- 2. email/password identity rows (what signInWithPassword authenticates).
--    auth.identities.email is a generated column derived from identity_data->>'email'.
insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
select u.id, 'email', u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in ('beautyadmin@pgbeauty.test', 'beautystaff@pgbeauty.test')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- 3. profiles: role, names, email, status (idempotent repair of the trigger row).
update public.profiles p
set role = case u.email
             when 'beautyadmin@pgbeauty.test' then 'beauty_admin'
             else 'beauty_staff'
           end,
    first_name = coalesce(nullif(u.raw_user_meta_data ->> 'first_name', ''), p.first_name),
    last_name = coalesce(nullif(u.raw_user_meta_data ->> 'last_name', ''), p.last_name),
    email = u.email,
    account_status = 'Active'
from auth.users u
where u.id = p.user_id
  and u.email in ('beautyadmin@pgbeauty.test', 'beautystaff@pgbeauty.test');

-- 4. Transfer admin@pgbeauty.test history to accounts that still exist.
update public.purchase_orders po
set created_by = target.new_id
from (
  select (select id from auth.users where email = 'beautyadmin@pgbeauty.test') as new_id,
         (select id from auth.users where email = 'admin@pgbeauty.test') as old_id
) target
where target.old_id is not null
  and target.new_id is not null
  and po.created_by = target.old_id;

update public.inventory_movements im
set created_by = target.new_id
from (
  select (select id from auth.users where email = 'beautyadmin@pgbeauty.test') as new_id,
         (select id from auth.users where email = 'admin@pgbeauty.test') as old_id
) target
where target.old_id is not null
  and target.new_id is not null
  and im.created_by = target.old_id;

-- The 3 seeded orders become customer-owned (maria.santos), keeping sales
-- analytics intact; the shipping snapshot follows the new owner.
update public.orders o
set user_id = target.new_id,
    shipping_name = target.shipping_name,
    shipping_email = target.shipping_email
from (
  select (select id from auth.users where email = 'maria.santos@pgbeauty.test') as new_id,
         (select id from auth.users where email = 'admin@pgbeauty.test') as old_id,
         'Maria Santos'::text as shipping_name,
         'maria.santos@pgbeauty.test'::text as shipping_email
) target
where target.old_id is not null
  and target.new_id is not null
  and o.user_id = target.old_id;

-- 5. Delete the legacy accounts (guarded: skipped if any history still points
--    at them, so the script can never orphan a foreign key).
delete from auth.users u
where u.email in ('admin@pgbeauty.test', 'admin2@pgbeauty.test', '1admin@pgbeauty.test')
  and not exists (select 1 from public.purchase_orders po where po.created_by = u.id)
  and not exists (select 1 from public.inventory_movements im where im.created_by = u.id)
  and not exists (select 1 from public.orders o where o.user_id = u.id);

-- 6. Audit trail (idempotent), attributed to the surviving super_admin.
with created(email, role) as (
  values ('beautyadmin@pgbeauty.test', 'beauty_admin'),
         ('beautystaff@pgbeauty.test', 'beauty_staff')
)
insert into public.user_activity_log (actor_id, action, details)
select a.id, 'user.created', jsonb_build_object('email', c.email, 'role', c.role, 'source', 'bootstrap script')
from created c
cross join (select id from auth.users where email = 'admin3@pgbeauty.test') a
where not exists (
  select 1 from public.user_activity_log l where l.action = 'user.created' and l.details ->> 'email' = c.email
);

with removed(email) as (
  values ('admin@pgbeauty.test'), ('admin2@pgbeauty.test'), ('1admin@pgbeauty.test')
)
insert into public.user_activity_log (actor_id, action, details)
select a.id, 'user.removed', jsonb_build_object('email', r.email, 'source', 'bootstrap script')
from removed r
cross join (select id from auth.users where email = 'admin3@pgbeauty.test') a
where not exists (
  select 1 from public.user_activity_log l where l.action = 'user.removed' and l.details ->> 'email' = r.email
);

commit;

-- Post-run expectations: exactly the 2 new staff accounts exist; the legacy
-- column must return zero rows.
select u.email, p.role, p.account_status, p.first_name, p.last_name, p.document_number
from auth.users u join public.profiles p on p.user_id = u.id
where u.email in ('beautyadmin@pgbeauty.test', 'beautystaff@pgbeauty.test')
order by u.email;

select u.email as "LEGACY ACCOUNT STILL PRESENT (must be empty)"
from auth.users u
where u.email in ('admin@pgbeauty.test', 'admin2@pgbeauty.test', '1admin@pgbeauty.test');
