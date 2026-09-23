import { supabase } from './supabase';

export async function fetchSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, contact_email, phone, address, created_at, supplier_products(product_id), purchase_orders(id, po_no, status, created_at)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => {
    const uniqueProductIds = new Set((row.supplier_products || []).map((entry: any) => entry.product_id).filter(Boolean));
    const purchaseOrders = (row.purchase_orders || [])
      .slice()
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((purchase: any) => ({
        po: purchase.po_no || purchase.id,
        date: purchase.created_at ? new Date(purchase.created_at).toLocaleDateString() : 'N/A',
        amount: 'See order total',
        status: purchase.status,
        items: 0,
      }));

    return {
      id: row.id,
      name: row.name,
      contact: row.contact_email || row.phone || 'N/A',
      email: row.contact_email || '',
      phone: row.phone || '',
      products: uniqueProductIds.size,
      status: 'Active',
      lastOrder: purchaseOrders[0]?.date || 'N/A',
      purchaseOrders,
    };
  });
}

export async function fetchPurchases() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, created_at, total_amount, status, payment_method, profiles(full_name, email), order_items(quantity, price_at_purchase, product_variants(products(name)))')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => {
    const itemCount = (row.order_items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
    const productNames = (row.order_items || [])
      .map((item: any) => item.product_variants?.products?.name)
      .filter((name: string | undefined) => Boolean(name));

    return {
      id: row.order_no || row.id,
      createdBy: row.profiles?.full_name || row.profiles?.email || 'Customer',
      supplier: productNames.length ? productNames.join(', ') : 'Order items',
      date: row.created_at ? new Date(row.created_at).toLocaleDateString() : 'N/A',
      items: itemCount,
      total: `₱${Number(row.total_amount || 0).toFixed(2)}`,
      status: row.status,
      paymentMethod: row.payment_method,
      productSummary: productNames.length ? productNames.slice(0, 2).join(', ') + (productNames.length > 2 ? ' + more' : '') : 'No items listed',
    };
  });
}

export async function fetchCustomers() {
  const [{ data: profiles, error: profilesError }, { data: orders }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, phone, created_at, skin_profile, role').order('created_at', { ascending: false }),
    supabase.from('orders').select('id, user_id, order_no, created_at, total_amount, status').order('created_at', { ascending: false }),
  ]);
  if (profilesError) throw profilesError;
  const ordersByCustomer = new Map<string, any[]>();
  (orders || []).forEach(order => ordersByCustomer.set(order.user_id, [...(ordersByCustomer.get(order.user_id) || []), order]));
  const adminRoles = new Set(['Super Admin', 'Beauty Admin', 'Beauty Staff']);
  return (profiles || []).filter((row: any) => !adminRoles.has(row.role)).map((row: any) => {
    const customerOrders = ordersByCustomer.get(row.id) || [];
    const total = customerOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    return { id: row.id, name: row.full_name || 'Customer', email: row.email || '', phone: row.phone || '', joined: new Date(row.created_at).toLocaleDateString(), orders: customerOrders.length, total: `₱${total.toFixed(2)}`, segment: customerOrders.length > 10 ? 'VIP' : customerOrders.length > 2 ? 'Regular' : 'New', skinProfile: row.skin_profile || {}, orderHistory: customerOrders };
  });
}

export async function fetchTransactions() {
  const { data, error } = await supabase.from('orders').select('id, order_no, created_at, total_amount, payment_method, status, profiles(full_name), order_items(quantity)').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.order_no || row.id, customer: row.profiles?.full_name || '', date: new Date(row.created_at).toLocaleDateString(), items: (row.order_items || []).reduce((sum: number, item: any) => sum + item.quantity, 0), total: `₱${Number(row.total_amount || 0).toFixed(2)}`, payment: row.payment_method, status: row.status }));
}

// Real aggregates for the Sales page's summary cards — computed from every
// order in the table, not just the page of transactions shown below them
// (those two were previously unrelated: the cards were hardcoded strings).
export async function fetchSalesSummary() {
  const { data, error } = await supabase.from('orders').select('total_amount, status, created_at');
  if (error) throw error;
  const rows = data || [];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

  const isCancelled = (row: any) => row.status === 'Cancelled';
  const sales = rows.filter(row => !isCancelled(row));

  const todaySales = sales.filter(row => new Date(row.created_at) >= startOfToday).reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const monthSales = sales.filter(row => new Date(row.created_at) >= startOfMonth).reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const avgOrderValue = sales.length ? sales.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) / sales.length : 0;
  const returnRate = rows.length ? (rows.filter(isCancelled).length / rows.length) * 100 : 0;

  return { todaySales, monthSales, avgOrderValue, returnRate };
}

export async function fetchProductSales() {
  const { data, error } = await supabase.from('product_sales').select('*').order('revenue', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchAdminUsers() {
  const { data, error } = await supabase.from('profiles').select('id, full_name, email, role, created_at').neq('role', 'Customer').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, name: row.full_name, email: row.email, role: row.role, status: 'Active', lastLogin: new Date(row.created_at).toLocaleDateString() }));
}

export async function fetchRecommendationRules() {
  const { data, error } = await supabase.from('recommendation_rules').select('*').order('weight_modifier', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, name: row.rule_name, desc: `Skin triggers: ${(row.trigger_skin_type || []).join(', ')}`, priority: Number(row.weight_modifier) >= 1.5 ? 'High' : Number(row.weight_modifier) >= 1 ? 'Medium' : 'Low', active: row.is_active }));
}

export async function fetchDashboardData() {
  const [
    { data: monthly, error: monthlyError },
    { data: productSales, error: productsError },
    { data: orders, error: ordersError },
    { count: customerCount, error: customersError },
    { count: activeCustomerCount, error: activeCustomersError },
    { count: productCount, error: productCountError },
    { count: supplierCount, error: suppliersError },
    { data: inventoryRows, error: inventoryRowsError },
    { count: lowStock, error: lowStockError },
  ] = await Promise.all([
    supabase.from('sales_by_month').select('*').order('month_date'),
    supabase.from('product_sales').select('id, name, category_id, category_name, revenue, units_sold, stock').order('revenue', { ascending: false }),
    supabase.from('orders').select('total_amount, status'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'Customer'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'Customer').gt('last_seen_at', new Date(Date.now() - 2 * 60 * 1000).toISOString()),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
    supabase.from('suppliers').select('id', { count: 'exact', head: true }),
    supabase.from('inventory').select('stock_quantity'),
    supabase.from('inventory').select('variant_id', { count: 'exact', head: true }).lt('stock_quantity', 10),
  ]);
  if (monthlyError || productsError || ordersError || customersError || activeCustomersError || productCountError || suppliersError || inventoryRowsError || lowStockError) {
    throw monthlyError || productsError || ordersError || customersError || activeCustomersError || productCountError || suppliersError || inventoryRowsError || lowStockError;
  }
  const rows = productSales || [];
  const totalSales = (orders || []).filter(order => order.status !== 'Cancelled').reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  return {
    salesData: monthly || [],
    topProducts: rows.slice(0, 5).map(row => ({ name: row.name, sales: Number(row.revenue || 0) })),
    categoryData: Object.values(rows.reduce((groups: Record<string, { name: string; value: number }>, row: any) => {
      if (row.category_name === 'Oral Care') return groups;
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
    activeCustomerCount: activeCustomerCount || 0,
    productCount: productCount || 0,
    supplierCount: supplierCount || 0,
    inventoryUnits: (inventoryRows || []).reduce((sum, row) => sum + Number(row.stock_quantity || 0), 0),
    lowStock: lowStock || 0,
  };
}

export async function saveRecommendationRule(rule: { name: string; desc: string; priority: string }) {
  const priority = rule.priority === 'High' ? 1.5 : rule.priority === 'Medium' ? 1 : 0.7;
  const { error } = await supabase.from('recommendation_rules').insert({ rule_name: rule.name, trigger_skin_type: [], weight_modifier: priority });
  if (error) throw error;
}