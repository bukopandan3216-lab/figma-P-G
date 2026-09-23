import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Users, Package, AlertTriangle, Brain, ArrowUpRight } from 'lucide-react';
import { Card, Badge } from '../../components/ui';
import AdminSidebar from '../../components/AdminSidebar';
import { fetchDashboardData } from '../../lib/adminData';

const colorMap: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-[var(--rose-light)] text-[var(--primary)]',
};

const categoryColors = ['#B5697A', '#5B8C85', '#D4944C', '#6F82A8', '#8B6B9E', '#7A8F52'];

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState<any>({ salesData: [], topProducts: [], categoryData: [], totalSales: 0, customerCount: 0, activeCustomerCount: 0, productCount: 0, supplierCount: 0, inventoryUnits: 0, lowStock: 0 });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      void fetchDashboardData()
        .then(data => { setDashboard(data); setError(null); })
        .catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load dashboard data.'));
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const { salesData, topProducts, categoryData } = dashboard;
  const totalCategoryValue = categoryData.reduce((sum: number, item: any) => sum + item.value, 0) || 1;
  const topProduct = topProducts[0];
  const summaryItems = [
    dashboard.totalSales > 0
      ? `Recorded revenue is ₱${dashboard.totalSales.toLocaleString()} across current sales data.`
      : 'No completed sales have been recorded yet.',
    topProduct
      ? `${topProduct.name} is currently the leading product by revenue at ₱${topProduct.sales.toLocaleString()}.`
      : 'Product performance will appear after sales are recorded.',
    `${dashboard.activeCustomerCount} customer${dashboard.activeCustomerCount === 1 ? '' : 's'} currently active in the last two minutes, out of ${dashboard.customerCount} registered customers.`,
    `${dashboard.productCount} active products, ${dashboard.supplierCount} suppliers, and ${dashboard.inventoryUnits.toLocaleString()} units currently tracked in inventory.`,
    dashboard.lowStock > 0
      ? `${dashboard.lowStock} inventory item${dashboard.lowStock === 1 ? '' : 's'} need${dashboard.lowStock === 1 ? 's' : ''} replenishment attention.`
      : 'Inventory levels are currently above the low-stock threshold.',
  ];
  const kpis = [
    { label: 'Total Sales', value: `₱${dashboard.totalSales.toLocaleString()}`, change: 0, icon: <TrendingUp size={18} />, color: 'emerald' },
    { label: 'Customers', value: dashboard.customerCount.toLocaleString(), change: 0, icon: <Users size={18} />, color: 'blue' },
    { label: 'Active Products', value: dashboard.productCount.toLocaleString(), change: 0, icon: <Package size={18} />, color: 'rose' },
    { label: 'Inventory Units', value: dashboard.inventoryUnits.toLocaleString(), change: 0, icon: <Package size={18} />, color: 'blue' },
    { label: 'Low Stock Alerts', value: String(dashboard.lowStock), change: 0, icon: <AlertTriangle size={18} />, color: 'amber' },
  ];
  return (
    <AdminSidebar>
      <div className="flex flex-col gap-6 animate-fade-in">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">Dashboard</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Welcome back, Super Admin · Sept 21, 2026</p>
        </div>
        {error && <div className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Dashboard data error: {error}</div>}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {kpis.map(kpi => (
            <Card key={kpi.label} className="p-5">
              <div className="flex items-start justify-between">
                <div className={`w-9 h-9 rounded-[var(--radius)] flex items-center justify-center ${colorMap[kpi.color]}`}>{kpi.icon}</div>
                <div className={`flex items-center gap-0.5 text-xs font-medium ${kpi.change > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {kpi.change > 0 ? <ArrowUpRight size={12} /> : <TrendingDown size={12} />}
                  {Math.abs(kpi.change)}%
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-[var(--foreground)]">{kpi.value}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{kpi.label}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Sales trend */}
          <Card className="lg:col-span-2 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-sm">Sales Trend</h2>
                <p className="text-xs text-[var(--muted-foreground)]">Last 6 months</p>
              </div>
              <Badge variant="success">↑ 12.4%</Badge>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => [`₱${Number(v || 0).toLocaleString()}`, 'Sales']} contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: 12 }} />
                <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={2.5} dot={{ fill: 'var(--primary)', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Category donut */}
          <Card className="p-5">
            <h2 className="font-semibold text-sm mb-1">Sales by Category</h2>
            <p className="text-xs text-[var(--muted-foreground)] mb-4">All recorded sales</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={categoryData.map((entry: any, index: number) => ({ ...entry, value: Math.round(entry.value / totalCategoryValue * 100), color: categoryColors[index % categoryColors.length] }))} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value">
                  {categoryData.map((entry: any, index: number) => <Cell key={index} fill={categoryColors[index % categoryColors.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => [`${Number(v || 0)}%`, '']} contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5 mt-2">
              {categoryData.map((cat: any, index: number) => (
                <div key={cat.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: categoryColors[index % categoryColors.length] }} />
                    <span className="text-[var(--muted-foreground)]">{cat.name}</span>
                  </div>
                  <span className="font-medium">{Math.round(cat.value / totalCategoryValue * 100)}%</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top products */}
          <Card className="p-5">
            <h2 className="font-semibold text-sm mb-4">Top Products by Revenue</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topProducts} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `₱${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v: any) => [`₱${Number(v || 0).toLocaleString()}`, 'Revenue']} contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', fontSize: 12 }} />
                <Bar dataKey="sales" fill="var(--primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* AI summary */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-sm">AI Summary</h2>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">Live readout from dashboard data</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-[var(--rose-light)] flex items-center justify-center text-[var(--primary)]"><Brain size={15} /></div>
            </div>
            <div className="flex flex-col gap-3">
              {summaryItems.map((summary, index) => (
                <div key={summary} className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-[var(--secondary)] flex items-center justify-center text-xs font-semibold text-[var(--primary)] flex-shrink-0">{index + 1}</div>
                  <p className="text-xs text-[var(--foreground)] leading-relaxed">{summary}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AdminSidebar>
  );
}
