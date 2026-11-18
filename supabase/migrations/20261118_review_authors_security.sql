-- Replace the security-definer review_authors view with a product-scoped,
-- hardened RPC. The view bypassed profiles RLS and exposed every customer's
-- display name to anyone holding the anon key.

begin;

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

notify pgrst, 'reload schema';

commit;
