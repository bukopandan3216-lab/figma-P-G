-- Remove the Oral Care category and every catalogue/transaction row that
-- belongs to it. The 278 affected orders contain only Oral Care lines, so they
-- are deleted once empty instead of leaving zero-item order history behind.
-- Oral-B and Crest are removed; the unrelated Test 2 product is moved to a new
-- Watsons brand owned by Watsons Philippines.

begin;

do $$
declare
  v_category_id uuid;
  v_watsons_supplier_id uuid;
  v_replacement_brand_id uuid;
begin
  select category_id into v_category_id
  from public.categories
  where lower(btrim(name)) = 'oral care';

  if v_category_id is null then
    raise notice 'Oral Care category already absent; skipping purge.';
    return;
  end if;

  create temp table purge_order_ids on commit drop as
  select distinct oi.order_id
  from public.order_items oi
  join public.product_variants v on v.variant_id = oi.variant_id
  join public.products p on p.product_id = v.product_id
  where p.category_id = v_category_id;

  create temp table purge_purchase_order_ids on commit drop as
  select distinct poi.purchase_order_id
  from public.purchase_order_items poi
  join public.products p on p.product_id = poi.product_id
  where p.category_id = v_category_id;

  delete from public.order_items oi
  using public.product_variants v, public.products p
  where oi.variant_id = v.variant_id
    and v.product_id = p.product_id
    and p.category_id = v_category_id;

  -- The seeded affected orders only contained Oral Care, so they are now empty.
  delete from public.orders o
  using purge_order_ids x
  where o.order_id = x.order_id
    and not exists (select 1 from public.order_items remaining where remaining.order_id = o.order_id);

  -- Defensive repair for any affected order that still has other lines.
  update public.orders o
  set subtotal = totals.subtotal,
      total_amount = totals.subtotal + o.shipping_fee + o.tax
  from (
    select oi.order_id,
           coalesce(sum(oi.quantity * oi.price_at_purchase), 0) as subtotal
    from public.order_items oi
    where oi.order_id in (select order_id from purge_order_ids)
    group by oi.order_id
  ) totals
  where o.order_id = totals.order_id;

  delete from public.purchase_order_items poi
  using public.products p
  where poi.product_id = p.product_id
    and p.category_id = v_category_id;

  delete from public.purchase_orders po
  using purge_purchase_order_ids x
  where po.purchase_order_id = x.purchase_order_id
    and not exists (select 1 from public.purchase_order_items remaining where remaining.purchase_order_id = po.purchase_order_id);

  update public.purchase_orders po
  set total_cost = totals.total_cost
  from (
    select poi.purchase_order_id,
           coalesce(sum(poi.quantity * poi.unit_cost), 0) as total_cost
    from public.purchase_order_items poi
    where poi.purchase_order_id in (select purchase_order_id from purge_purchase_order_ids)
    group by poi.purchase_order_id
  ) totals
  where po.purchase_order_id = totals.purchase_order_id;

  delete from public.inventory_movements im
  using public.product_variants v, public.products p
  where im.variant_id = v.variant_id
    and v.product_id = p.product_id
    and p.category_id = v_category_id;

  delete from public.recommendation_rules
  where target_category_id = v_category_id;

  select supplier_id into v_watsons_supplier_id
  from public.suppliers
  where name = 'Watsons Philippines';

  if v_watsons_supplier_id is null then
    raise exception 'Watsons Philippines supplier was not found.';
  end if;

  insert into public.brands (name, description, supplier_id)
  values ('Watsons', 'Watsons Philippines in-house beauty brand', v_watsons_supplier_id)
  on conflict (name) do update
    set supplier_id = excluded.supplier_id
  returning brand_id into v_replacement_brand_id;

  if v_replacement_brand_id is null then
    select brand_id into v_replacement_brand_id
    from public.brands
    where name = 'Watsons';
  end if;

  -- Preserve any non-Oral-Care product still owned by the removed brands.
  update public.products p
  set brand_id = v_replacement_brand_id
  from public.brands b
  where p.brand_id = b.brand_id
    and b.name in ('Oral-B', 'Crest');

  -- Cascades variants, inventory, reviews, cart/wishlist rows, interactions,
  -- and product recommendations.
  delete from public.products
  where category_id = v_category_id;

  delete from public.brands
  where name in ('Oral-B', 'Crest');

  delete from public.categories
  where category_id = v_category_id;

  if exists (select 1 from public.products where category_id = v_category_id) then
    raise exception 'Oral Care products still exist.';
  end if;
  if exists (select 1 from public.brands where name in ('Oral-B', 'Crest')) then
    raise exception 'Oral Care brands still exist.';
  end if;
  if not exists (select 1 from public.products where name = 'Test 2' and brand_id = v_replacement_brand_id) then
    raise exception 'Test 2 was not reassigned to the Watsons brand.';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
