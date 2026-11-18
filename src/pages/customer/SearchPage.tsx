import { useSearchParams, Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useCatalog } from '../../context/CatalogContext';
import { useCart } from '../../context/AppContext';
import { Button, Badge, EmptyState, LoadingState } from '../../components/ui';
import CustomerNav from '../../components/CustomerNav';
import { safeImage } from '../../lib/image';
import { resolveVariant } from '../../lib/variant';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { addToCart } = useCart();
  const { products, loading, error } = useCatalog();

  const results = products.filter(p => {
    const matchesQuery = p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.brand.toLowerCase().includes(q.toLowerCase()) ||
      p.category.toLowerCase().includes(q.toLowerCase()) ||
      p.tags.some(t => t.toLowerCase().includes(q.toLowerCase()));
    return matchesQuery;
  });

  if (loading) return <LoadingState fullScreen message="Hang tight, finding products…" />;
  if (error) return <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6 text-center"><p className="text-sm text-[var(--muted-foreground)]">{error}</p></div>;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl mb-1">
              {q ? <>Results for <em className="text-[var(--primary)] not-italic">"{q}"</em></> : 'Search Products'}
            </h1>
            {results.length > 0 && <p className="text-sm text-[var(--muted-foreground)]">{results.length} products found</p>}
          </div>
        </div>

        <div>
          <div>
            {results.length === 0 ? (
              <EmptyState
                icon={<Search size={48} className="opacity-30" />}
                title={q ? `No results for "${q}"` : 'Start searching'}
                description={q ? "Try different keywords or browse our categories below." : "Enter a product name, brand, or category to find what you're looking for."}
                action={
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {['Olay', 'Pantene', 'moisturizer', 'shampoo'].map(s => (
                      <Link key={s} to={`/search?q=${s}`} className="px-3 py-1 bg-[var(--secondary)] text-sm rounded-full text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors">{s}</Link>
                    ))}
                  </div>
                }
              />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {results.map(product => {
                  const selectedVariant = resolveVariant(product);
                  const displayPrice = selectedVariant.price;
                  const canBuy = product.inStock && selectedVariant.stock > 0;
                  const hasReviews = product.reviews > 0;
                  return (
                    <div key={product.id} className="group flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
                      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-[var(--secondary)]">
                        <img src={safeImage(product.image, product.name)} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        {product.badge && <div className="absolute top-2 left-2"><Badge variant="rose" className="text-[10px]">{product.badge}</Badge></div>}
                        {product.originalPrice != null && (
                          <div className="absolute top-2 right-2 bg-[var(--primary)] text-white px-2 py-1 rounded-[var(--radius)] text-xs font-bold">Sale</div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-3">
                        <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">{product.brand}</div>
                        <Link to={`/product/${product.id}`} className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 hover:text-[var(--primary)] transition-colors leading-snug">{product.name}</Link>
                        {hasReviews && (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-[var(--muted-foreground)]">({product.reviews.toLocaleString()})</span>
                          </div>
                        )}
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <span className="text-sm font-bold">₱{displayPrice.toFixed(2)}{selectedVariant.originalPrice != null && <span className="ml-1 text-xs text-[var(--muted-foreground)] line-through">₱{selectedVariant.originalPrice.toFixed(2)}</span>}</span>
                          <Button size="sm" onClick={() => addToCart({ id: product.id, name: product.name, brand: product.brand, price: displayPrice, image: product.image, stock: selectedVariant.stock, inStock: canBuy, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label })} disabled={!canBuy} className="text-xs px-2.5 py-1">Add</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Popular searches */}
        <div className="mt-12">
          <h2 className="font-semibold text-sm text-[var(--muted-foreground)] uppercase tracking-wide mb-4">Popular Searches</h2>
          <div className="flex flex-wrap gap-2">
            {['Anti-aging cream', 'Vitamin C serum', 'Dandruff shampoo', 'Body butter', 'Gentle cleanser', 'SPF moisturizer'].map(s => (
              <Link key={s} to={`/search?q=${encodeURIComponent(s)}`} className="px-4 py-2 border border-[var(--border)] rounded-full text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors">{s}</Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
