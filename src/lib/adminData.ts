import { supabase } from './supabase';
import { NEAR_EXPIRY_DAYS, expiryStatus, expiryBadgeVariant, formatExpiryDate } from './expiry';

export async function fetchSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id:supplier_id, name, contact_name, contact_email, phone, address, status, created_at, brands(brand_id, name, products(id:product_id, name, product_variants(id:variant_id))), purchase_orders(id:purchase_order_id, po_no, status, created_at, total_cost)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => {
    // Ownership chain: supplier -> brands -> products -> variants.
    const brands = row.brands || [];
    const productIds = new Set<string>();
    const productNames = new Set<string>();
    let variantCount = 0;
    for (const brand of brands) {
      for (const product of brand.products || []) {
        if (product.id) productIds.add(product.id);
        if (product.name) productNames.add(product.name);
        variantCount += (product.product_variants || []).length;
      }
    }
    const brandNames = brands.map((brand: any) => brand.name).filter(Boolean) as string[];
    const purchaseOrders = (row.purchase_orders || [])
      .slice()
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((purchase: any) => ({
        po: purchase.po_no || purchase.id,
        date: purchase.created_at ? new Date(purchase.created_at).toLocaleDateString() : 'N/A',
        amount: `₱${Number(purchase.total_cost || 0).toFixed(2)}`,
        status: purchase.status,
        items: 0,
      }));

    return {
      id: row.id,
      name: row.name,
      contact: row.contact_name || 'N/A',
      address: row.address || '',
      email: row.contact_email || '',
      phone: row.phone || '',
      products: productIds.size,
      productIds: Array.from(productIds),
      productNames: Array.from(productNames),
      brands: brandNames,
      brandCount: brandNames.length,
      variantCount,
      status: row.status || 'Active',
      lastOrder: purchaseOrders[0]?.date || 'N/A',
      purchaseOrders,
    };
  });
}

export type CategoryOption = { id: string; name: string };

/** Real category UUIDs for catalogue editors (never the storefront slugs). */
export async function fetchCategoryOptions(): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id:category_id, name')
    .order('name');
  if (error) throw error;
  return ((data || []) as CategoryOption[]).filter(category => category.id && category.name);
}

export type SupplierInput = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
};

export async function upsertSupplier(input: SupplierInput, supplierId?: string) {
  const values = {
    name: input.name.trim(),
    contact_name: input.contactName.trim(),
    contact_email: input.email.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
  };
  const result = supplierId
    ? await supabase.from('suppliers').update(values).eq('supplier_id', supplierId)
    : await supabase.from('suppliers').insert(values).select('id:supplier_id').single();
  if (result.error) throw result.error;
  return supplierId || (result.data as any)?.id || '';
}

export type SupplierCatalogVariantInput = {
  size: string;
  price: string;
  stock: string;
  expiryDate: string;
};

export type SupplierCatalogProductInput = {
  name: string;
  categoryId: string;
  description: string;
  tags: string[];
  variants: SupplierCatalogVariantInput[];
};

/**
 * Onboards a supplier and its catalogue in one transaction: the supplier owns
 * one unique brand, the brand owns new products, and each product owns its
 * size variants. The RPC rejects any brand, product, or variant that already
 * exists anywhere in the catalogue.
 */
export async function createSupplierCatalog(input: {
  supplier: SupplierInput;
  brandName: string;
  products: SupplierCatalogProductInput[];
}) {
  const { data, error } = await supabase.rpc('create_supplier_catalog', {
    p_name: input.supplier.name.trim(),
    p_contact_name: input.supplier.contactName.trim(),
    p_contact_email: input.supplier.email.trim(),
    p_phone: input.supplier.phone.trim(),
    p_address: input.supplier.address.trim(),
    p_brand_name: input.brandName.trim(),
    p_products: input.products.map(product => ({
      name: product.name.trim(),
      category_id: product.categoryId,
      description: product.description.trim(),
      tags: product.tags,
      variants: product.variants.map(variant => ({
        size: variant.size.trim(),
        price: Number(variant.price),
        stock: Number(variant.stock || 0),
        expiry_date: variant.expiryDate,
      })),
    })),
  });
  if (error) throw error;
  return data as string;
}

/** Adds another unique brand (with its products and variants) to a supplier. */
export async function createSupplierBrand(input: {
  supplierId: string;
  brandName: string;
  products: SupplierCatalogProductInput[];
}) {
  const { data, error } = await supabase.rpc('create_supplier_brand', {
    p_supplier_id: input.supplierId,
    p_brand_name: input.brandName.trim(),
    p_products: input.products.map(product => ({
      name: product.name.trim(),
      category_id: product.categoryId,
      description: product.description.trim(),
      tags: product.tags,
      variants: product.variants.map(variant => ({
        size: variant.size.trim(),
        price: Number(variant.price),
        stock: Number(variant.stock || 0),
        expiry_date: variant.expiryDate,
      })),
    })),
  });
  if (error) throw error;
  return data as string;
}

export async function setSupplierStatus(supplierId: string, status: 'Active' | 'Inactive' | 'Archived') {
  const { error } = await supabase.from('suppliers').update({ status }).eq('supplier_id', supplierId);
  if (error) throw error;
}

export async function fetchPurchaseProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id:product_id, name')
    .eq('status', 'Active')
    .order('name');
  if (error) throw error;
  return data || [];
}

// ─── Purchase order catalog: supplier → brand → product → variant ────────────
// One fetch feeds the whole cascade on the Purchases page. Every active
// product comes with its owning supplier, its brand, and its variants.
// `supplier_price` is NOT selectable over REST (revoked for anon and
// authenticated), so costs arrive from the purchases/view-gated RPC
// `get_variant_supplier_costs` and only feed the modal's running grand total —
// they are never rendered per line and never posted back (the database reads
// the cost itself when the order is created).
export type PurchaseCatalogVariant = { id: string; label: string; unitCost: number };
export type PurchaseCatalogProduct = {
  id: string;
  name: string;
  brandId: string;
  brandName: string;
  supplierId: string;
  variants: PurchaseCatalogVariant[];
};

export async function fetchPurchaseCatalog(): Promise<PurchaseCatalogProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id:product_id, name, status, brand_id, brands(name, supplier_id), product_variants(id:variant_id, size, sku)')
    .eq('status', 'Active')
    .order('name');
  if (error) throw error;

  const products = ((data || []) as any[])
    .map((row): PurchaseCatalogProduct => ({
      id: row.id,
      name: row.name,
      brandId: row.brand_id || '',
      brandName: row.brands?.name || '',
      supplierId: row.brands?.supplier_id || '',
      variants: (row.product_variants || []).map((variant: any) => ({
        id: variant.id,
        label: variant.size?.trim() || variant.sku || 'Variant',
        unitCost: 0,
      })),
    }))
    .filter(product => product.brandId && product.variants.length > 0);

  const variantIds = products.flatMap(product => product.variants.map(variant => variant.id));
  if (!variantIds.length) return products;

  const { data: costs, error: costError } = await supabase.rpc('get_variant_supplier_costs', { p_variant_ids: variantIds });
  if (costError) throw costError;
  const costByVariant = new Map<string, number>(
    ((costs || []) as any[]).map((row: any) => [row.variant_id as string, Number(row.unit_cost || 0)]),
  );
  for (const product of products) {
    product.variants = product.variants.map(variant => ({ ...variant, unitCost: costByVariant.get(variant.id) ?? 0 }));
  }
  return products;
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  expectedDelivery: string;
  paymentTerms: string;
  notes: string;
  items: { productId: string; variantId: string; quantity: number }[];
}) {
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_supplier_id: input.supplierId,
    p_expected_delivery: input.expectedDelivery || null,
    p_payment_terms: input.paymentTerms.trim(),
    p_notes: input.notes.trim(),
    // No unit_cost is sent: the RPC reads the hidden supplier price itself.
    p_items: input.items.map(item => ({
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
    })),
  });
  if (error) throw error;
  return data;
}

/** Records the supplier delivery: stock increases and the movement is traced to the PO. */
export async function receivePurchaseOrder(purchaseOrderId: string, notes?: string) {
  const { data, error } = await supabase.rpc('receive_purchase_order', {
    p_purchase_order_id: purchaseOrderId,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
}

export async function fetchPurchases() {  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id:purchase_order_id, po_no, created_at, expected_delivery, total_cost, status, created_by, profiles:created_by(first_name, last_name, email), suppliers(name), purchase_order_items(quantity, products(name), product_variants(size))')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => {
    const itemCount = (row.purchase_order_items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    // Lines are variant-level now: "100ml ×20".
    const lines = (row.purchase_order_items || [])
      .map((item: any) => {
        const variantLabel = item.product_variants?.size?.trim() || '';
        const name = item.products?.name;
        return name ? `${name}${variantLabel ? ` (${variantLabel})` : ''} ×${Number(item.quantity || 0)}` : null;
      })
      .filter((line: string | null): line is string => Boolean(line));
    const creator = row.profiles as { first_name?: string; last_name?: string; email?: string } | null;
    const creatorName = creator
      ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim()
      : '';

    return {
      id: row.po_no || row.id,
      purchaseOrderId: row.id,
      createdBy: creatorName || creator?.email || 'Unknown staff member',
      supplier: row.suppliers?.name || 'Supplier',
      date: row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A',
      expectedDelivery: row.expected_delivery ? new Date(`${row.expected_delivery}T00:00:00`).toLocaleDateString() : '—',
      items: itemCount,
      total: `₱${Number(row.total_cost || 0).toFixed(2)}`,
      status: row.status,
      productSummary: lines.length ? lines.slice(0, 2).join(', ') + (lines.length > 2 ? ' + more' : '') : 'No items listed',
    };
  });
}

export async function fetchCustomers() {
  const [{ data: profiles, error: profilesError }, { data: orders }] = await Promise.all([
    supabase.from('profiles').select('id:user_id, first_name, last_name, email, phone, created_at, skin_profile, account_status, last_seen_at, document_number').eq('role', 'customer').order('created_at', { ascending: false }),
    supabase.from('orders').select('id:order_id, user_id, order_no, created_at, total_amount, status').order('created_at', { ascending: false }),
  ]);
  if (profilesError) throw profilesError;
  const ordersByCustomer = new Map<string, any[]>();
  (orders || []).forEach(order => ordersByCustomer.set(order.user_id, [...(ordersByCustomer.get(order.user_id) || []), order]));

  // Loyalty tier (New / Silver / Gold / Platinum / Diamond) comes straight from
  // the public.get_customer_segment() rule function so the app and the database
  // can never disagree about a customer's standing.
  const segmentResults = await Promise.all((profiles || []).map(async row => {
    const { data, error } = await supabase.rpc('get_customer_segment', { p_user_id: row.id });
    return error ? null : (data as unknown as string);
  }));

  return (profiles || []).map((row: any, index: number) => {
    const customerOrders = ordersByCustomer.get(row.id) || [];
    const total = customerOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Customer';
    return { id: row.id, name, email: row.email || '', phone: row.phone || '', documentNumber: row.document_number || '', joined: new Date(row.created_at).toLocaleDateString(), orders: customerOrders.length, total: `₱${total.toFixed(2)}`, segment: segmentResults[index] || 'New', skinProfile: row.skin_profile || {}, orderHistory: customerOrders, accountStatus: row.account_status === 'Inactive' ? 'Inactive' : 'Active', lastSeenAt: row.last_seen_at };
  });
}

export async function fetchTransactions() {
  const { data, error } = await supabase.from('orders').select('id:order_id, order_no, created_at, total_amount, payment_method, payment_status, status, profiles(first_name, last_name), order_items(quantity, price_at_purchase, product_variants(id:variant_id, product_id, products(name, image)))').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.order_no || row.id,
    customer: `${row.profiles?.first_name || ''} ${row.profiles?.last_name || ''}`.trim(),
    date: new Date(row.created_at).toLocaleDateString(),
    items: (row.order_items || []).reduce((sum: number, item: any) => sum + item.quantity, 0),
    total: `₱${Number(row.total_amount || 0).toFixed(2)}`,
    payment: row.payment_method,
    paymentStatus: row.payment_status,
    status: row.status,
    orderItems: (row.order_items || []).map((item: any) => ({
      productName: item.product_variants?.products?.name || 'Product',
      productImage: item.product_variants?.products?.image || '',
      quantity: item.quantity,
      priceAtPurchase: item.price_at_purchase,
    })),
  }));
}

// Real aggregates for the Sales page's summary cards — computed from every
// order in the table, not just the page of transactions shown below them
// (those two were previously unrelated: the cards were hardcoded strings).
export async function fetchSalesSummary() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
  const [{ data: allOrders, error: allOrdersError }, { data: monthOrders, error: monthOrdersError }] = await Promise.all([
    supabase.from('orders').select('total_amount, status, created_at'),
    supabase.from('orders').select('total_amount, status, created_at')
      .gte('created_at', startOfMonth.toISOString())
      .order('created_at', { ascending: false }),
  ]);
  if (allOrdersError || monthOrdersError) throw allOrdersError || monthOrdersError;
  const rows = allOrders || [];

  const isCancelled = (row: any) => row.status === 'Cancelled';
  const sales = rows.filter(row => !isCancelled(row));
  const monthSalesRows = (monthOrders || []).filter(row => !isCancelled(row));

  const todaySales = monthSalesRows.filter(row => new Date(row.created_at) >= startOfToday).reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const monthSales = monthSalesRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const avgOrderValue = sales.length ? sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) / sales.length : 0;
  const returnRate = rows.length ? (rows.filter(isCancelled).length / rows.length) * 100 : 0;

  return { todaySales, monthSales, avgOrderValue, returnRate };
}

export async function fetchProductSales() {
  const { data, error } = await supabase.from('product_sales').select('id:product_id, name, category_id, category_name, revenue, units_sold, stock, reorder_level').order('revenue', { ascending: false });
  if (error) throw error;
  return Object.values((data || []).reduce((groups: Record<string, any>, row: any) => {
    const group = groups[row.id] || { ...row, revenue: 0, units_sold: 0, stock: 0 };
    group.revenue += Number(row.revenue || 0);
    group.units_sold += Number(row.units_sold || 0);
    group.stock += Number(row.stock || 0);
    groups[row.id] = group;
    return groups;
  }, {})).sort((left: any, right: any) => right.revenue - left.revenue);
}

export async function fetchAdminUsers() {
  // Customers are managed on their own (and in customer accounts), so this
  // page only lists staff and administrator accounts.
     const { data, error } = await supabase.from('profiles')
       .select('id:user_id, first_name, last_name, email, role, account_status, created_at')
       .neq('role', 'customer')
       .order('created_at', { ascending: false });
     if (error) throw error;
     return (data || []).map(row => ({ id: row.id, name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unnamed user', email: row.email || '', role: row.role, accountStatus: row.account_status || 'Active', createdAt: row.created_at }));
}

export async function fetchRecommendationRules() {
  const { data, error } = await supabase.from('recommendation_rules').select('id:rule_id, rule_name, trigger_skin_type, weight_modifier, is_active').order('weight_modifier', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, name: row.rule_name, desc: `Skin triggers: ${(row.trigger_skin_type || []).join(', ')}`, priority: Number(row.weight_modifier) >= 1.5 ? 'High' : Number(row.weight_modifier) >= 1 ? 'Medium' : 'Low', active: row.is_active }));
}

export async function fetchDashboardData() {
     const monthlyQuery = supabase.from('sales_by_month').select('*').order('month_date');
     const productSalesQuery = supabase.from('product_sales').select('id:product_id, name, category_id, category_name, revenue, units_sold, stock').order('revenue', { ascending: false });
     const ordersQuery = supabase.from('orders').select('total_amount, status');
     const inventoryQuery = supabase.from('inventory').select('stock_quantity');
     const lowStockQuery = supabase.from('inventory').select('variant_id', { count: 'exact', head: true }).lt('stock_quantity', 10);
     // Everything already expired plus everything inside the 60-day Near Expiry
     // window — both are hidden from the storefront and refused at checkout.
     const expiringQuery = supabase
       .from('product_variants')
       .select('variant_id, size, expiry_date, products(name), inventory(stock_quantity)')
       .not('expiry_date', 'is', null)
       .lte('expiry_date', new Date(Date.now() + NEAR_EXPIRY_DAYS * 86_400_000).toISOString().slice(0, 10))
       .order('expiry_date', { ascending: true });
     const [
       { data: monthly, error: monthlyError },
       { data: productSales, error: productsError },
       { data: orders, error: ordersError },
       { count: customerCount, error: customersError },
       { count: productCount, error: productCountError },
       { count: supplierCount, error: suppliersError },
       { data: inventoryRows, error: inventoryRowsError },
       { count: lowStock, error: lowStockError },
       { data: expiring, error: expiringError },
     ] = await Promise.all([
       monthlyQuery,
       productSalesQuery,
       ordersQuery,
       supabase.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'customer'),
       supabase.from('products').select('product_id', { count: 'exact', head: true }).eq('status', 'Active'),
       supabase.from('suppliers').select('supplier_id', { count: 'exact', head: true }),
       inventoryQuery,
       lowStockQuery,
       expiringQuery,
     ]);
     if (monthlyError || productsError || ordersError || customersError || productCountError || suppliersError || inventoryRowsError || lowStockError || expiringError) {
       throw monthlyError || productsError || ordersError || customersError || productCountError || suppliersError || inventoryRowsError || lowStockError || expiringError;
     }
  const rows = Object.values((productSales || []).reduce((groups: Record<string, any>, row: any) => {
    const group = groups[row.id] || { ...row, revenue: 0, units_sold: 0, stock: 0 };
    group.revenue += Number(row.revenue || 0);
    group.units_sold += Number(row.units_sold || 0);
    group.stock += Number(row.stock || 0);
    groups[row.id] = group;
    return groups;
  }, {}));
  const salesByMonth = Object.values((monthly || []).reduce((groups: Record<string, any>, row: any) => {
    const group = groups[row.month_date] || { month_date: row.month_date, month: row.month, sales: 0, orders: 0 };
    group.sales += Number(row.sales || 0);
    group.orders += Number(row.orders || 0);
    groups[row.month_date] = group;
    return groups;
  }, {})).sort((left: any, right: any) => left.month_date.localeCompare(right.month_date));
  const totalSales = (orders || []).filter(order => order.status !== 'Cancelled').reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  return {
    salesData: salesByMonth,
    topProducts: rows.slice(0, 5).map(row => ({ name: row.name, sales: Number(row.revenue || 0) })),
    categoryData: Object.values(rows.reduce((groups: Record<string, { name: string; value: number }>, row: any) => {
      const categoryKey = row.category_name === 'Personal Care' || row.category_name === 'Body Care'
        ? 'Personal & Body Care'
        : row.category_name || row.category_id || 'Uncategorized';
      const group = groups[categoryKey] || { name: categoryKey, value: 0 };
      group.value += Number(row.revenue || 0);
      groups[categoryKey] = group;
      return groups;
    }, {})),
    totalSales,
    customerCount: customerCount || 0,
    productCount: productCount || 0,
    supplierCount: supplierCount || 0,
       inventoryUnits: (inventoryRows || []).reduce((sum, row) => sum + Number(row.stock_quantity || 0), 0),
       lowStock: lowStock || 0,
       expiringVariants: ((expiring || []) as any[]).map(row => {
         const inventoryRow = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory;
         const product = Array.isArray(row.products) ? row.products[0] : row.products;
         const expiryDate = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;
         const status = expiryStatus(expiryDate);
         return {
           id: row.variant_id,
           product: product?.name || 'Product',
           variant: row.size || 'Standard',
           expiryDate,
           expiryLabel: formatExpiryDate(expiryDate),
           status,
           badge: expiryBadgeVariant(status),
           stock: Number(inventoryRow?.stock_quantity || 0),
           filter: status === 'Expired' ? 'expired' : 'near-expiry',
         };
       }),
     };
}

export async function saveRecommendationRule(rule: { name: string; desc: string; priority: string }) {
  const priority = rule.priority === 'High' ? 1.5 : rule.priority === 'Medium' ? 1 : 0.7;
  const { error } = await supabase.from('recommendation_rules').insert({ rule_name: rule.name, trigger_skin_type: [], weight_modifier: priority });
  if (error) throw error;
}

export async function fetchUserActivity() {
  const { data, error } = await supabase.rpc('get_staff_activity');
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.event_id,
    user: row.user_name || 'Unknown user',
    role: row.user_role || row.details?.role || 'Unknown role',
    action: row.action,
    details: row.details || {},
    time: row.occurred_at,
  }));
}

export async function fetchCustomerActivity() {
  const { data, error } = await supabase.rpc('get_customer_activity');
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.event_id,
    customer: row.customer_name || row.customer_email || 'Customer',
    email: row.customer_email || '',
    action: row.action,
    details: row.details || {},
    time: row.occurred_at,
  }));
}

export async function setCustomerAccountStatus(userId: string, status: 'Active' | 'Inactive') {
  const { error } = await supabase.rpc('set_customer_account_status', {
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw error;
}

export async function manageUser(payload: { action: 'invite'; first_name: string; last_name: string; email: string; role: string } | { action: 'role'; id: string; role: string } | { action: 'status'; id: string; status: 'Active' | 'Inactive' }) {
  const { data, error } = await supabase.functions.invoke('manage-user', { body: payload });
  if (error) {
    const context = 'context' in error ? error.context : undefined;
    if (context instanceof Response) {
      const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof body?.error === 'string') throw new Error(body.error);
    }
    throw new Error(error.message || 'User management request failed.');
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.user) throw new Error('User management returned no profile.');
  return data.user;
}

export async function fetchCustomerInsights() {
  const [interactionsResult, profilesResult, cartResult, wishlistResult, ordersResult, salesResult] = await Promise.all([
    supabase.from('customer_product_interactions').select('product_id, interaction_type, recommendation_id, products(name, tags, categories(name))'),
    supabase.from('profiles').select('skin_profile').eq('role', 'customer'),
    supabase.from('cart_items').select('product_id'),
    supabase.from('wishlist_items').select('product_id'),
    supabase.from('orders').select('status, order_items(quantity, product_variants(product_id, products(name, tags, categories(name))))'),
    fetchProductSales(),
  ]);
  const queryError = interactionsResult.error || profilesResult.error || cartResult.error || wishlistResult.error || ordersResult.error;
  if (queryError) throw queryError;

  const productCounts = new Map<string, { product: string; interactions: number; views: number; cart: number; wishlist: number; purchases: number }>();
  // "Most bought" charts are driven by what customers actually PURCHASED,
  // not by browsing/cart chatter or the beauty-quiz preferences.
  const boughtCategories = new Map<string, number>();
  const boughtCharacteristics = new Map<string, number>();
  const ensureProduct = (id: string, name = 'Product') => {
    const current = productCounts.get(id) || { product: name, interactions: 0, views: 0, cart: 0, wishlist: 0, purchases: 0 };
    if (name !== 'Product') current.product = name;
    productCounts.set(id, current);
    return current;
  };
  const increment = (map: Map<string, number>, key: string, amount = 1) => {
    const normalizedKey = key.trim();
    if (normalizedKey) map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
  };

  for (const row of interactionsResult.data || []) {
    const product = (row as any).products;
    const counts = ensureProduct(row.product_id, product?.name || 'Product');
    counts.interactions += 1;
    if (row.interaction_type === 'view') counts.views += 1;
    if (row.interaction_type === 'cart') counts.cart += 1;
    if (row.interaction_type === 'wishlist') counts.wishlist += 1;
    if (row.interaction_type === 'purchase') counts.purchases += 1;
  }
  for (const row of cartResult.data || []) { const counts = ensureProduct(row.product_id); counts.cart += 1; counts.interactions += 1; }
  for (const row of wishlistResult.data || []) { const counts = ensureProduct(row.product_id); counts.wishlist += 1; counts.interactions += 1; }
  for (const order of ordersResult.data || []) {
    if (order.status === 'Cancelled') continue;
    for (const item of (order as any).order_items || []) {
      const variant = item.product_variants;
      const productId = variant?.product_id;
      const quantity = Number(item.quantity || 1);
      if (productId) { const counts = ensureProduct(productId, variant?.products?.name || 'Product'); counts.purchases += quantity; counts.interactions += quantity; }
      const product = variant?.products;
      if (!product) continue;
      increment(boughtCategories, product?.categories?.name || 'Uncategorized', quantity);
      for (const tag of product?.tags || []) increment(boughtCharacteristics, tag, quantity);
    }
  }

  const interactionRows = interactionsResult.data || [];
  const shown = interactionRows.filter(row => row.interaction_type === 'recommendation_shown').length;
  const clicked = interactionRows.filter(row => row.interaction_type === 'recommendation_clicked' && row.recommendation_id).length;
  const purchased = interactionRows.filter(row => row.interaction_type === 'purchase' && row.recommendation_id).length;
  const ranked = (map: Map<string, number>) => [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    frequentProducts: [...productCounts.entries()].map(([id, counts]) => ({ id, ...counts })).sort((a, b) => b.interactions - a.interactions).slice(0, 8),
    preferredCategories: ranked(boughtCategories),
    preferredCharacteristics: ranked(boughtCharacteristics),
    topSellingProducts: (salesResult || []).slice().sort((a: any, b: any) => Number(b.units_sold || 0) - Number(a.units_sold || 0)).slice(0, 8),
    recommendationEngagement: {
      shown,
      clicked,
      purchased,
      clickRate: shown ? Math.round(clicked / shown * 100) : 0,
      purchaseRate: clicked ? Math.round(purchased / clicked * 100) : 0,
    },
    customerCount: profilesResult.data?.length || 0,
  };
}