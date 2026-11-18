-- Supplier-created products now carry the tags entered in the Add Supplier /
-- Add Brand form. Tags arrive as a JSON array on each product draft, are
-- normalized to lowercase, and are stored in products.tags.

begin;

create or replace function public._create_brand_catalog(
  p_supplier_id uuid,
  p_brand_name text,
  p_products jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare
  v_brand_id uuid;
  v_product jsonb;
  v_variant jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_price numeric;
  v_min_price numeric;
  v_size text;
  v_expiry date;
  v_category_id uuid;
  v_product_name text;
  v_tags text[];
begin
  if p_supplier_id is null then
    raise exception 'Choose a supplier.';
  end if;
  if coalesce(btrim(p_brand_name), '') = '' then
    raise exception 'Brand name is required.';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then
    raise exception 'Add at least one product for this brand.';
  end if;
  if exists (select 1 from public.brands where lower(btrim(name)) = lower(btrim(p_brand_name))) then
    raise exception 'Brand "%" already exists. Every supplier needs a unique brand.', btrim(p_brand_name);
  end if;

  insert into public.brands (name, supplier_id)
  values (btrim(p_brand_name), p_supplier_id)
  returning brand_id into v_brand_id;

  for v_product in select value from jsonb_array_elements(p_products) loop
    v_product_name := btrim(coalesce(v_product->>'name', ''));
    if v_product_name = '' then
      raise exception 'Every product needs a name.';
    end if;
    if exists (select 1 from public.products where lower(btrim(name)) = lower(v_product_name)) then
      raise exception 'Product "%" already exists in the catalogue. Products must be unique to this brand.', v_product_name;
    end if;
    if coalesce(v_product->'variants', '[]'::jsonb) = '[]'::jsonb then
      raise exception 'Product "%" needs at least one variant.', v_product_name;
    end if;
    v_category_id := nullif(btrim(coalesce(v_product->>'category_id', '')), '')::uuid;
    if v_category_id is null or not exists (select 1 from public.categories where category_id = v_category_id) then
      raise exception 'Product "%": choose a valid category.', v_product_name;
    end if;

    select min((item.value->>'price')::numeric)
      into v_min_price
      from jsonb_array_elements(v_product->'variants') item;
    if v_min_price is null or v_min_price < 0 then
      raise exception 'Product "%": every variant needs a valid price.', v_product_name;
    end if;

    select coalesce(array_agg(distinct normalized.tag), '{}'::text[])
      into v_tags
      from (
        select lower(regexp_replace(btrim(tag_item #>> '{}'), '\s+', ' ', 'g')) as tag
        from jsonb_array_elements(
          case when jsonb_typeof(v_product->'tags') = 'array' then v_product->'tags' else '[]'::jsonb end
        ) as tag_item
        where jsonb_typeof(tag_item) = 'string'
      ) normalized
      where normalized.tag <> '';

    insert into public.products (brand_id, category_id, name, description, price, tags, status)
    values (v_brand_id, v_category_id, v_product_name,
            nullif(btrim(coalesce(v_product->>'description', '')), ''), v_min_price, v_tags, 'Active')
    returning product_id into v_product_id;

    for v_variant in select value from jsonb_array_elements(v_product->'variants') loop
      v_size := nullif(btrim(coalesce(v_variant->>'size', '')), '');
      if v_size is null then
        raise exception 'Product "%": each variant needs a size.', v_product_name;
      end if;
      v_price := (v_variant->>'price')::numeric;
      if v_price is null or v_price < 0 then
        raise exception 'Product "%": each variant needs a valid price.', v_product_name;
      end if;
      v_expiry := nullif(btrim(coalesce(v_variant->>'expiry_date', '')), '')::date;
      if v_expiry is null then
        raise exception 'Product "%": each variant needs an expiry date.', v_product_name;
      end if;
      if exists (
        select 1 from public.product_variants
        where product_id = v_product_id and lower(btrim(size)) = lower(v_size)
      ) then
        raise exception 'Product "%" already has that size.', v_product_name;
      end if;

      insert into public.product_variants (
        product_id, size, additional_price, supplier_price, sku, expiry_date
      ) values (
        v_product_id, v_size, v_price - v_min_price,
        round(v_price / 1.30, 2),
        'PGB-' || upper(substr(replace(v_product_id::text, '-', ''), 1, 6)) || '-' ||
          upper(substr(md5(v_size || '|' || random()::text), 1, 8)),
        v_expiry
      )
      returning variant_id into v_variant_id;

      insert into public.inventory (variant_id, stock_quantity, reorder_level)
      values (v_variant_id, greatest(coalesce((v_variant->>'stock')::integer, 0), 0), 10);
    end loop;
  end loop;

  return v_brand_id;
end;
$fn$;

revoke all on function public._create_brand_catalog(uuid, text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
