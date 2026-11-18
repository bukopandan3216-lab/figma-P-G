-- P&G Beauty curated catalog seed (additive and repeatable).
--
-- Run AFTER supabase/schema/split/schema_fresh.sql (or schema_upgrade.sql).
-- Auth accounts are managed by Supabase Auth, not by this file: existing
-- profiles are reused, nothing is deleted, and every insert is guarded, so it
-- is safe to re-run against a live database. Every variant receives an expiry
-- date (the demo mix includes five near-expiry and one expired variant).

begin;

-- 1. Suppliers ---------------------------------------------------------------
insert into public.suppliers (name, contact_email, phone, address)
select supplier.name, supplier.contact_email, supplier.phone, supplier.address
from (values
  ('Procter & Gamble Philippines Inc.', null, '+63 2 8790 0000', 'Makati City, Metro Manila'),
  ('Rustan Commercial Corporation', null, '+63 2 8888 0000', 'Makati City, Metro Manila'),
  ('Watsons Philippines', null, '+63 2 8790 6000', 'Quezon City, Metro Manila'),
  ('SM Retail Inc.', null, '+63 2 8870 0000', 'Pasay City, Metro Manila'),
  ('Puregold Price Club Inc.', null, '+63 2 8528 8000', 'Quezon City, Metro Manila'),
  ('Robinsons Retail Holdings Inc.', null, '+63 2 8397 8888', 'Quezon City, Metro Manila')
) as supplier(name, contact_email, phone, address)
where not exists (select 1 from public.suppliers existing where existing.name = supplier.name);

-- 2. Brands: each supplier starts with exactly two unique brands ------------
insert into public.brands (name, description, supplier_id)
select brand.name, brand.description, supplier.supplier_id
from (values
  ('Olay', 'Dermatologist-tested facial skincare and anti-aging care', 'Procter & Gamble Philippines Inc.'),
  ('Pantene', 'Hair care, repair, and moisture products', 'Procter & Gamble Philippines Inc.'),
  ('Head & Shoulders', 'Scalp care and anti-dandruff hair products', 'Robinsons Retail Holdings Inc.'),
  ('Secret', 'Antiperspirant and deodorant products', 'Robinsons Retail Holdings Inc.'),
  ('Ivory', 'Gentle body cleansing and moisturizing products', 'SM Retail Inc.'),
  ('Gillette', 'Men''s shaving and grooming products', 'SM Retail Inc.'),
  ('Always', 'Menstrual and feminine care products', 'Puregold Price Club Inc.'),
  ('Tampax', 'Tampons and period care products', 'Puregold Price Club Inc.'),
  ('Old Spice', 'Men''s deodorant, body wash, and grooming products', 'Rustan Commercial Corporation'),
  ('SK-II', 'Premium facial treatment skincare', 'Rustan Commercial Corporation'),
  ('Watsons', 'Watsons Philippines in-house beauty brand', 'Watsons Philippines')
) as brand(name, description, supplier_name)
join public.suppliers supplier on supplier.name = brand.supplier_name
on conflict (name) do update
  set description = excluded.description,
      supplier_id = excluded.supplier_id;

-- 3. Categories --------------------------------------------------------------
insert into public.categories (name, description, image) values
  ('Skin Care', 'Moisturizers, serums, cleansers, and treatments', 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=600&h=400&fit=crop&auto=format'),
  ('Hair Care', 'Shampoo, conditioner, masks, and scalp treatments', 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=400&fit=crop&auto=format'),
  ('Body Care', 'Body wash, lotion, cream, and deodorant', 'https://images.unsplash.com/photo-1585232350009-d608de6e5f50?w=600&h=400&fit=crop&auto=format'),
  ('Personal Care', 'Shaving, feminine care, and daily essentials', 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&h=400&fit=crop&auto=format')
on conflict (name) do update set description = excluded.description, image = excluded.image;

-- 4. Products ----------------------------------------------------------------
with catalog(brand, category, name, description, price, original_price, tags, rating, reviews, badge) as (
  values
  ('Olay','Skin Care','Regenerist Micro-Sculpting Cream','Amino-peptide moisturizer that firms skin and reduces the appearance of fine lines.',28.99,34.99,'{moisturizer,anti-aging,face cream}',4.7,2341,'Best Seller'),
  ('Olay','Skin Care','Regenerist Retinol 24 Night Face Moisturizer','Fragrance-free night moisturizer with retinol, vitamin B3, and peptides.',31.99,36.99,'{retinol,night cream,anti-aging}',4.6,1874,null),
  ('Olay','Skin Care','Vitamin C Brightening Serum','Vitamin C and niacinamide serum for a brighter, more even-looking complexion.',22.49,null,'{serum,vitamin c,brightening}',4.6,1489,null),
  ('Olay','Skin Care','Hyaluronic + Peptide 24 Eye Gel','Hydrating eye gel with hyaluronic acid and peptides.',24.99,29.99,'{eye care,hydration,peptides}',4.5,923,'New'),
  ('Olay','Skin Care','Gentle Foaming Cleanser','Creamy foaming cleanser that removes dirt and makeup without over-drying.',10.99,null,'{cleanser,gentle,sensitive}',4.5,3120,null),
  ('SK-II','Skin Care','Facial Treatment Essence','Fermented Pitera essence for smoother and more radiant-looking skin.',179.00,199.00,'{essence,pitera,premium}',4.8,812,'Premium'),
  ('SK-II','Skin Care','GenOptics Ultraura Essence','Brightening essence formulated for luminous-looking skin.',189.00,null,'{essence,brightening,premium}',4.7,364,null),
  ('Pantene','Hair Care','Pro-V Moisture Boost Shampoo','Pro-Vitamin B5 shampoo for soft, moisturized hair.',12.49,null,'{shampoo,moisture,haircare}',4.5,8732,'Best Seller'),
  ('Pantene','Hair Care','Pro-V Moisture Boost Conditioner','Daily conditioner that helps smooth and moisturize dry hair.',12.49,null,'{conditioner,moisture,haircare}',4.5,4210,null),
  ('Pantene','Hair Care','Miracle Rescue Deep Conditioner','Deep conditioning treatment for visibly damaged hair.',14.99,17.99,'{treatment,repair,deep conditioning}',4.6,2890,'Sale'),
  ('Pantene','Hair Care','Gold Series Moisture Boost Shampoo','Moisturizing shampoo designed for textured and curly hair.',13.99,null,'{shampoo,curly hair,moisture}',4.6,1973,null),
  ('Pantene','Hair Care','Pro-V Total Damage Care 5 Shampoo','Strengthening shampoo for five signs of damage.',11.99,null,'{shampoo,repair,damage care}',4.4,3501,null),
  ('Head & Shoulders','Hair Care','Classic Clean 2-in-1 Shampoo','Shampoo and conditioner with anti-dandruff protection.',9.99,null,'{shampoo,dandruff,2-in-1}',4.5,10234,'Best Seller'),
  ('Head & Shoulders','Hair Care','Clinical Strength Itch Relief Shampoo','Clinical-strength scalp care for itch and dandruff.',14.49,null,'{scalp care,dandruff,clinical}',4.4,3456,'Almost Sold Out'),
  ('Head & Shoulders','Hair Care','Royal Oils Moisture Boost Shampoo','Moisture-focused scalp and hair care for textured hair.',11.49,null,'{scalp care,moisture,textured hair}',4.5,1290,null),
  ('Secret','Personal Care','Clinical Strength Antiperspirant Powder Fresh','48-hour sweat and odor protection with a powder scent.',11.99,null,'{deodorant,antiperspirant,powder}',4.8,12504,'Best Seller'),
  ('Secret','Personal Care','Aluminum Free Deodorant Coconut & Cocoa Butter','Aluminum-free deodorant with a warm coconut scent.',8.99,null,'{deodorant,aluminum free,coconut}',4.3,1248,null),
  ('Old Spice','Personal Care','Swagger Antiperspirant Deodorant','Long-lasting odor protection with a classic fresh scent.',8.49,9.99,'{deodorant,antiperspirant,men}',4.7,9871,'Sale'),
  ('Old Spice','Body Care','Fiji with Coconut Oil Body Wash','Cleansing body wash with coconut and tropical fragrance notes.',7.99,null,'{body wash,coconut,men}',4.6,6120,null),
  ('Ivory','Body Care','Gentle Original Body Wash','Simple gentle body wash for everyday cleansing.',6.49,null,'{body wash,gentle,sensitive}',4.3,2850,null),
  ('Ivory','Body Care','Ultra Rich Shea Butter Body Wash','Rich body wash with shea butter for dry skin.',7.49,8.49,'{body wash,shea butter,dry skin}',4.4,1920,'Sale'),
  ('Gillette','Personal Care','Fusion5 ProGlide Razor','Flexing razor with five anti-friction blades.',18.99,22.99,'{shaving,razor,grooming}',4.7,8042,'Best Seller'),
  ('Gillette','Personal Care','SkinGuard Sensitive Razor','Sensitive-skin razor designed to reduce irritation.',16.49,null,'{shaving,sensitive skin,grooming}',4.5,2951,null),
  ('Gillette','Personal Care','Series Sensitive Shave Gel','Lubricating shave gel for sensitive skin.',6.99,null,'{shaving,sensitive skin,shave gel}',4.5,1465,null),
  ('Always','Personal Care','Infinity FlexFoam Size 2 Pads','Thin menstrual pads with flexible absorbent protection.',8.99,null,'{feminine care,pads,period}',4.6,8012,'Best Seller'),
  ('Always','Personal Care','Pure Cotton FlexFoam Size 2 Pads','Cottony soft period pads with flexible protection.',9.49,null,'{feminine care,cotton,pads}',4.5,3260,null),
  ('Always','Personal Care','Discreet Boutique Liners','Everyday pantiliners designed for comfort and discretion.',5.49,null,'{feminine care,liners,daily care}',4.4,2198,null),
  ('Tampax','Personal Care','Pearl Regular Tampons','Applicator tampons with leak protection for regular flow.',8.99,null,'{feminine care,tampons,period}',4.6,4560,'Best Seller'),
  ('Tampax','Personal Care','Pure Cotton Super Tampons','Cotton tampons with applicator for heavier flow days.',9.99,null,'{feminine care,tampons,cotton}',4.5,2210,null),
  ('Pantene','Hair Care','Pro-V Curl Perfection Conditioner','Conditioner for defined, soft curls and frizz control.',13.49,null,'{conditioner,curls,frizz control}',4.5,1840,null),
  ('Olay','Skin Care','Ultra Moisture Body Wash','Moisturizing body wash with shea butter.',8.49,null,'{body wash,moisture,shea butter}',4.4,2480,null),
  ('Secret','Personal Care','Coconut Splash Invisible Solid','Invisible solid antiperspirant with coconut fragrance.',7.49,null,'{deodorant,antiperspirant,coconut}',4.5,1940,null),
  ('Gillette','Personal Care','Mach3 Sensitive Razor','Three-blade razor with lubrication for sensitive skin.',13.99,null,'{shaving,razor,sensitive skin}',4.5,3210,null)
)
insert into public.products (brand_id, category_id, name, description, price, original_price, image, tags, rating, reviews, badge, status, created_at)
select b.brand_id, c.category_id, catalog.name, catalog.description, catalog.price, catalog.original_price, null, catalog.tags::text[], catalog.rating, catalog.reviews, catalog.badge, 'Active',
       now() - ((row_number() over (order by catalog.name)::integer % 120) || ' days')::interval
from catalog
join public.brands b on b.name = catalog.brand
join public.categories c on c.name = catalog.category
where not exists (select 1 from public.products existing where existing.name = catalog.name);

-- 5. Variants ----------------------------------------------------------------
-- Two variants per active product. supplier_price is derived from the listing
-- price with the same 30% markup the app uses (src/lib/catalog.ts).
insert into public.product_variants (product_id, size, additional_price, supplier_price, sku, expiry_date)
select
  p.product_id,
  v.size,
  v.additional_price,
  round((coalesce(p.original_price, p.price) + v.additional_price) / 1.30, 2),
  'PGB-' || upper(substr(md5(p.name || '-' || v.size), 1, 10)),
  current_date + (120 + abs(hashtext(p.product_id::text || v.size)) % 420)
from public.products p
cross join lateral (
  values
    ('Standard', 0.00::numeric),
    ('Value Size', 2.50::numeric)
) as v(size, additional_price)
where p.status = 'Active'
and not exists (
  select 1 from public.product_variants existing
  where existing.product_id = p.product_id
);

-- Demo expiry mix: five near-expiry variants (+12/+21/+35/+48/+55 days), one
-- expired variant (-14 days), everything else 4-18 months out. Deterministic,
-- and the product stays visible because every product has a second variant.
with ranked as (
  select
    v.variant_id,
    row_number() over (partition by v.product_id order by v.sku) as variant_rank,
    dense_rank() over (order by v.product_id) as product_rank
  from public.product_variants v
  join public.products p on p.product_id = v.product_id
  where p.status = 'Active'
)
update public.product_variants v
set expiry_date = case
  when r.product_rank <= 5 and r.variant_rank = 1
    then current_date + (array[12, 21, 35, 48, 55])[r.product_rank::integer]
  when r.product_rank = 6 and r.variant_rank = 1
    then current_date - 14
  else current_date + (120 + abs(hashtext(v.variant_id::text)) % 420)
end
from ranked r
where r.variant_id = v.variant_id;

-- No variant may be left without an expiry date, archived/test rows included.
update public.product_variants
set expiry_date = current_date + (120 + abs(hashtext(variant_id::text)) % 420)
where expiry_date is null;

-- 5. Inventory and opening movements ----------------------------------------
insert into public.inventory (variant_id, stock_quantity, reorder_level)
select v.variant_id,
  case when right(v.sku, 1) in ('A','B') then 6 else 35 + (abs(hashtext(v.sku)) % 260) end,
  case when p.name in ('Clinical Strength Itch Relief Shampoo','Classic Clean 2-in-1 Shampoo') then 15 else 10 end
from public.product_variants v
join public.products p on p.product_id = v.product_id
where not exists (select 1 from public.inventory existing where existing.variant_id = v.variant_id);

insert into public.inventory_movements (variant_id, movement_type, quantity, reference, notes)
select inventory.variant_id, 'Stock In', inventory.stock_quantity, 'INITIAL-RECEIVING', 'Opening inventory balance from approved catalog intake.'
from public.inventory inventory
where not exists (
  select 1 from public.inventory_movements existing
  where existing.variant_id = inventory.variant_id and existing.reference = 'INITIAL-RECEIVING'
);



-- 6. Recommendation rules ----------------------------------------------------
insert into public.recommendation_rules (rule_name, trigger_skin_type, target_category_id, weight_modifier)
select rule.rule_name, rule.trigger_skin_type, category.category_id, rule.weight_modifier
from (values
  ('Hydration for Dry Skin', array['Dry']::text[], 'Skin Care', 1.50::numeric),
  ('Sensitive Skin Care', array['Sensitive']::text[], 'Skin Care', 1.45::numeric),
  ('Anti-Aging Routine', array['Mature','Anti-Aging']::text[], 'Skin Care', 1.35::numeric),
  ('Hair Repair Routine', array['Dry','Damaged','Frizzy']::text[], 'Hair Care', 1.30::numeric),
  ('Inventory Availability', array[]::text[], null, 1.10::numeric)
) rule(rule_name, trigger_skin_type, category_name, weight_modifier)
left join public.categories category on category.name = rule.category_name
where not exists (select 1 from public.recommendation_rules existing where existing.rule_name = rule.rule_name);

-- 8. Demo purchase orders ----------------------------------------------------
-- Only runs when an admin/staff profile exists. po_no makes the block repeatable.
with admin_profile as (
  select user_id from public.profiles
  where role in ('super_admin', 'beauty_admin', 'beauty_staff')
  order by created_at
  limit 1
),
supplier_targets as (
  select supplier_id, name, row_number() over (order by name) as supplier_rank
  from public.suppliers
  where name in (
    'Procter & Gamble Philippines Inc.', 'Rustan Commercial Corporation', 'Watsons Philippines',
    'SM Retail Inc.', 'Puregold Price Club Inc.', 'Robinsons Retail Holdings Inc.'
  )
)
insert into public.purchase_orders (created_by, supplier_id, status, total_cost, created_at, po_no)
select
  admin_profile.user_id,
  supplier_targets.supplier_id,
  status.value,
  round((850 + abs(hashtext(supplier_targets.name || status.value)) % 18000)::numeric, 2),
  now() - (abs(hashtext(supplier_targets.name || status.value)) % 90) * interval '1 day',
  'SEED-PO-' || lpad(supplier_targets.supplier_rank::text, 2, '0') || '-' || status.value
from supplier_targets
cross join admin_profile
cross join lateral (values ('Received'), ('Approved'), ('Shipped'), ('Pending')) status(value)
on conflict (po_no) do nothing;

insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
select po.purchase_order_id, product.product_id, 12 + (abs(hashtext(po.purchase_order_id::text)) % 80), round((product.price * 0.62)::numeric, 2)
from public.purchase_orders po
join lateral (
  select p.product_id, p.price
  from public.products p
  join public.brands b on b.brand_id = p.brand_id
  where b.supplier_id = po.supplier_id
  order by md5(po.purchase_order_id::text || p.product_id::text)
  limit 1
) product on true
where po.po_no like 'SEED-PO-%'
and not exists (
  select 1 from public.purchase_order_items existing where existing.purchase_order_id = po.purchase_order_id
);

commit;
