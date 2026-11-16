begin;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  review text not null check (char_length(btrim(review)) between 10 and 1200),
  created_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create index if not exists product_reviews_product_created_idx
  on public.product_reviews(product_id, created_at desc);

alter table public.product_reviews enable row level security;
drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews
  for select to anon, authenticated using (true);
revoke all on public.product_reviews from anon, authenticated;
grant select on public.product_reviews to anon, authenticated;

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
  if not exists (select 1 from public.products where id = p_product_id and status = 'Active') then
    raise exception 'Product is unavailable for review';
  end if;
  if not exists (
    select 1
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.product_variants v on v.id = oi.variant_id
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

revoke all on function public.submit_product_review(uuid, integer, text) from public, anon;
grant execute on function public.submit_product_review(uuid, integer, text) to authenticated;

commit;