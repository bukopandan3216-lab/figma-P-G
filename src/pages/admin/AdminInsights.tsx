import { useEffect, useState } from 'react';
import AdminSidebar from '../../components/AdminSidebar';
import { Badge, Button, LoadingState } from '../../components/ui';
import { fetchCustomerInsights } from '../../lib/adminData';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import ProductModal from '../../components/ProductModal';
import { useCatalog } from '../../context/CatalogContext';
import { safeImage } from '../../lib/image';

type InsightData = Awaited<ReturnType<typeof fetchCustomerInsights>>;

const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

export default function AdminInsights() {
  const [data, setData] = useState<InsightData | null>(null);
  const [error, setError] = useState('');
  const [modalProduct, setModalProduct] = useState<any>(null);
  const { products } = useCatalog();

  useEffect(() => {
    let active = true;
    void fetchCustomerInsights().then(result => {
      if (active) { setData(result); setError(''); }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load customer insights.');
    });
    return () => { active = false; };
  }, []);

  return (
    <AdminSidebar>
      <div className="flex flex-col gap-6 animate-fade-in">
        <div>
          <h1 className="text-xl font-bold">Customer and Product Insights</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Computed from Beauty profiles, interactions, shopping, and sales records.</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!data && !error && <LoadingState message="Hang tight, gathering customer insights…" />}
        {data && <>
          <ProductModal product={modalProduct} onClose={() => setModalProduct(null)} />
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[['Customers', data.customerCount], ['Recommendations Shown', data.recommendationEngagement.shown], ['Clicked', data.recommendationEngagement.clicked], ['Purchased', data.recommendationEngagement.purchased], ['Click Rate', `${data.recommendationEngagement.clickRate}%`]].map(([label, value]) => (
              <section key={String(label)} className="bg-white border border-[var(--border)] rounded-[var(--radius)] p-4">
                <div className="text-2xl font-bold">{value}</div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</div>
              </section>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Frequently Interacted-With Products */}
            <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
              <h2 className="font-semibold text-sm mb-3">Frequently Interacted-With Products</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--muted-foreground)] border-b border-[var(--border)]">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 px-2">Interactions</th>
                      <th className="py-2 px-2">Views</th>
                      <th className="py-2 px-2">Cart</th>
                      <th className="py-2 px-2">Wishlist</th>
                      <th className="py-2 pl-2">Purchases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.frequentProducts.slice(0, 6).map(item => (
                      <tr key={item.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 pr-3 font-medium">{item.product}</td>
                        <td className="py-2 px-2">{item.interactions}</td>
                        <td className="py-2 px-2">{item.views}</td>
                        <td className="py-2 px-2">{item.cart}</td>
                        <td className="py-2 px-2">{item.wishlist}</td>
                        <td className="py-2 pl-2">{item.purchases}</td>
                      </tr>
                    ))}
                    {data.frequentProducts.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">No customer interactions recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Top-Selling Beauty Products - Floating card */}
            <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
              <h2 className="font-semibold text-sm mb-3">Top-Selling Beauty Products</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.topSellingProducts.slice(0, 8).map(item => {
                  const fullProduct = products.find(p => p.id === item.id);
                  return (
                    <div key={item.id} className="border border-[var(--border)] rounded-[var(--radius-lg)] p-3 flex flex-col hover:bg-[var(--secondary)] transition-colors cursor-pointer" onClick={() => fullProduct ? setModalProduct(fullProduct) : setModalProduct(item)}>
                      <div className="aspect-square bg-[var(--secondary)] rounded-[var(--radius-md)] overflow-hidden mb-2 flex items-center justify-center">
                        {fullProduct?.image
                          ? <img src={safeImage(fullProduct.image, item.name)} alt={item.name} className="h-full w-full object-cover" />
                          : <span className="text-[var(--muted-foreground)] text-xs">{item.name.charAt(0)}</span>}
                      </div>
                      <p className="font-medium text-sm line-clamp-2">{item.name}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.units_sold} units sold · ₱{Number(item.revenue || 0).toLocaleString()}</p>
                    </div>
                  );
                })}
                {data.topSellingProducts.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No sales recorded yet.</p>}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Commonly Preferred Categories - Pie Chart with labels */}
            <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
              <h2 className="font-semibold text-sm mb-3">Commonly Preferred Categories</h2>
              {data.preferredCategories.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip />
                      <Pie
                        data={data.preferredCategories}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        fill="#8884d8"
                        label={({ name, value }: any) => `${name}: ${value}`}
                        labelLine
                      >
                        {data.preferredCategories.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-sm text-[var(--muted-foreground)] text-center py-8">No category preferences recorded yet.</p>}
            </section>

            {/* Preferred Product Characteristics - Bar chart so long trait names stay readable */}
            <section className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
              <h2 className="font-semibold text-sm mb-3">Preferred Product Characteristics</h2>
              {data.preferredCharacteristics.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.preferredCharacteristics} margin={{ top: 8, right: 8, left: -18, bottom: 52 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
                      <Bar dataKey="count" name="Units ordered" radius={[6, 6, 0, 0]}>
                        {data.preferredCharacteristics.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-sm text-[var(--muted-foreground)] text-center py-8">No product characteristics recorded yet.</p>}
            </section>
          </div>

          <p className="text-xs text-[var(--muted-foreground)]">Recommendation purchase rate: {data.recommendationEngagement.purchaseRate}% of clicked recommendations. Total interactions leading to clicks: {data.recommendationEngagement.clicked} | Total purchases from recommendations: {data.recommendationEngagement.purchased}.</p>
        </>}
      </div>
    </AdminSidebar>
  );
}
