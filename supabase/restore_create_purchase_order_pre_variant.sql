-- ============================================================================
-- ROLLBACK CHECKPOINT — variant-level purchase orders + supplier pricing
-- Captured before: PO variant lines, product_variants.supplier_price column,
-- the create_purchase_order rewrite, the get_variant_supplier_costs RPC, and
-- the narrowed product_variants column grants.
--
-- To roll the database back, run this file, then run these statements:
--   drop function if exists public.get_variant_supplier_costs(uuid[]);
--   revoke select (variant_id, product_id, size, scent, additional_price, sku)
--     on public.product_variants from anon, authenticated;
--   grant select on public.product_variants to anon, authenticated;
--   drop column if exists public.product_variants.supplier_price;
--
-- (the grant/revoke pair restores the original whole-table read for the
-- storefront; without it the catalog would lose product_variants entirely.)
--
-- The matching git checkpoint is: 904ac4a
--   ("checkpoint: before variant-level purchase orders + supplier pricing")
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_expected_delivery date, p_payment_terms text, p_notes text, p_items jsonb)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.purchase_orders;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_cost numeric;
  v_total numeric := 0;
  v_po_no text;
begin
  if not public.has_permission('purchases', 'create') then
    raise exception using errcode = '42501', message = 'Purchase order management access required';
  end if;

  if not exists (select 1 from public.suppliers where supplier_id = p_supplier_id and status = 'Active') then
    raise exception 'Select an active supplier';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Purchase order items must be a list';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the purchase order';
  end if;

  v_po_no := 'PO-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.purchase_orders (
    created_by, supplier_id, status, total_cost, po_no,
    expected_delivery, payment_terms, notes
  ) values (
    auth.uid(), p_supplier_id, 'Pending', 0, v_po_no,
    p_expected_delivery, coalesce(p_payment_terms, ''), coalesce(p_notes, '')
  ) returning * into v_order;

  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each purchase order item must be an object';
    end if;

    v_product_id := nullif(v_item ->> 'product_id', '')::uuid;
    v_quantity := nullif(v_item ->> 'quantity', '')::integer;
    v_unit_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
    if v_product_id is null or v_quantity is null or v_quantity <= 0 or v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'Each item requires a product, positive quantity, and non-negative unit cost';
    end if;
    if not exists (select 1 from public.products where product_id = v_product_id and status = 'Active') then
      raise exception 'Purchase order products must be active';
    end if;

    insert into public.purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
    values (v_order.purchase_order_id, v_product_id, v_quantity, v_unit_cost);
    v_total := v_total + v_quantity * v_unit_cost;
  end loop;

  update public.purchase_orders set total_cost = v_total where purchase_order_id = v_order.purchase_order_id returning * into v_order;
  return v_order;
end;
$function$

