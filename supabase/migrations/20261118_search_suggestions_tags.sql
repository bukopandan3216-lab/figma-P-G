-- Search suggestions now expose product tags so clients can surface tag-aware
-- results without an additional catalog lookup. No new tables added.

begin;

drop function if exists public.get_search_suggestions(integer);

create or replace function public.get_search_suggestions(p_limit integer default 5)
returns table (
  section text,
  product_id uuid,
  name text,
  brand_name text,
  image text,
  tags text[],
  score bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_user uuid := auth.uid();
  v_has_history boolean := false;
begin
  if v_user is not null then
    select exists (
      select 1
      from public.customer_product_interactions
      where user_id = v_user
    ) into v_has_history;
  end if;

  if v_has_history then
    return query
    select
      'frequent'::text,
      p.product_id,
      p.name,
      b.name,
      coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
      p.tags,
      count(*)::bigint
    from public.customer_product_interactions interaction
    join public.products p on p.product_id = interaction.product_id
    join public.brands b on b.brand_id = p.brand_id
    where interaction.user_id = v_user
      and p.status = 'Active'
      and exists (
        select 1
        from public.product_variants variant
        where variant.product_id = p.product_id
          and (variant.expiry_date is null or variant.expiry_date > current_date + 60)
      )
    group by p.product_id, p.name, b.name, p.image, p.images, p.tags
    order by count(*) desc, p.name
    limit v_limit;
  else
    return query
    select
      'frequent'::text,
      p.product_id,
      p.name,
      b.name,
      coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
      p.tags,
      count(*)::bigint
    from public.customer_product_interactions interaction
    join public.products p on p.product_id = interaction.product_id
    join public.brands b on b.brand_id = p.brand_id
    where p.status = 'Active'
      and exists (
        select 1
        from public.product_variants variant
        where variant.product_id = p.product_id
          and (variant.expiry_date is null or variant.expiry_date > current_date + 60)
      )
    group by p.product_id, p.name, b.name, p.image, p.images, p.tags
    order by count(*) desc, p.name
    limit v_limit;
  end if;

  return query
  select
    'top_selling'::text,
    p.product_id,
    p.name,
    b.name,
    coalesce(nullif(btrim(p.image), ''), p.images[1], ''),
    p.tags,
    sum(item.quantity)::bigint
  from public.order_items item
  join public.orders o on o.order_id = item.order_id
  join public.product_variants variant on variant.variant_id = item.variant_id
  join public.products p on p.product_id = variant.product_id
  join public.brands b on b.brand_id = p.brand_id
  where o.status <> 'Cancelled'
    and p.status = 'Active'
    and exists (
      select 1
      from public.product_variants sellable
      where sellable.product_id = p.product_id
        and (sellable.expiry_date is null or sellable.expiry_date > current_date + 60)
    )
  group by p.product_id, p.name, b.name, p.image, p.images, p.tags
  order by sum(item.quantity) desc, p.name
  limit v_limit;
end;
$fn$;

revoke all on function public.get_search_suggestions(integer) from public;
grant execute on function public.get_search_suggestions(integer) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
