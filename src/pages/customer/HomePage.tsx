import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Zap, Shield, Truck, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Product } from '../../data/products';
import { useCatalog } from '../../context/CatalogContext';
import { useCart } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { recommendProducts } from '../../lib/recommendations';
import { Badge, Button, StarRating, LoadingState } from '../../components/ui';
import CustomerNav from '../../components/CustomerNav';
import CustomerFooter from '../../components/CustomerFooter';
import ProductModal from '../../components/ProductModal';
import { safeImage } from '../../lib/image';
import { resolveVariant } from '../../lib/variant';

function ProductCard({ product, onExpand }: { product: Product; onExpand: (p: Product) => void }) {
  const { addToCart, toggleWishlist, wishlist } = useCart();
  const wished = wishlist.includes(product.id);
  // Cards sell the first sellable variant; the detail page lets the shopper
  // pick another one.
  const selectedVariant = resolveVariant(product);
  const displayPrice = selectedVariant.price;
  const hasReviews = product.reviews > 0;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
      <div
        role="button"
        tabIndex={0}
        className="relative block aspect-square w-full cursor-pointer overflow-hidden bg-[var(--secondary)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        onClick={() => onExpand(product)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(product); } }}
      >
        <img src={safeImage(product.image, product.name)} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        {product.badge && (
          <div className="absolute top-3 left-3">
            <Badge variant={product.badge === 'Almost Sold Out' ? 'warning' : product.badge === 'Sale' ? 'danger' : 'rose'}>{product.badge}</Badge>
          </div>
        )}
        {!product.inStock && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-sm font-medium text-muted-foreground">Out of Stock</span>
          </div>
        )}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); toggleWishlist(product.id); }}
          aria-label={`${wished ? 'Remove' : 'Add'} ${product.name} ${wished ? 'from' : 'to'} wishlist`}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow-sm transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <Heart size={16} fill={wished ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--primary)]">{product.brand}</div>
          <button onClick={() => onExpand(product)} className="w-full text-left text-sm font-semibold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] line-clamp-2">{product.name}</button>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-sm font-bold text-foreground">₱{displayPrice.toFixed(2)}{selectedVariant.originalPrice != null && <span className="ml-2 text-xs font-normal text-muted-foreground line-through">₱{selectedVariant.originalPrice.toFixed(2)}</span>}</span>
          {hasReviews && (
            <div className="flex items-center gap-1 text-xs font-medium text-[var(--foreground)]/75">
              <StarRating rating={product.rating} />
              <span>({product.reviews.toLocaleString()})</span>
            </div>
          )}
        </div>
        <Button size="sm" className="mt-3 w-full" onClick={() => addToCart({ id: product.id, name: product.name, brand: product.brand, price: displayPrice, image: product.image, stock: selectedVariant.stock, inStock: product.inStock && selectedVariant.stock > 0, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label })} disabled={!product.inStock || selectedVariant.stock <= 0}>Add</Button>
      </div>
    </article>
  );
}

export default function HomePage() {
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const { products, categories, loading, error } = useCatalog();
  const { user } = useAuth();
  const trendingRef = useRef<HTMLDivElement>(null);
  const [recommendations, setRecommendations] = useState<Product[]>([]);
  const trending = products.filter(p => p.badge === 'Almost Sold Out' || p.badge === 'Best Seller');

  // The personalized shelf is unlocked only after the beauty quiz is completed.
  const hasQuiz = Boolean(user?.skinProfile && Object.keys(user.skinProfile).length > 0);

  useEffect(() => {
    let active = true;
    if (!hasQuiz || !user?.id || !products.length) {
      setRecommendations([]);
      return () => { active = false; };
    }
    void recommendProducts(user.id, products)
      .then(list => { if (active) setRecommendations(list.slice(0, 8).map(item => item.product)); })
      .catch(() => { if (active) setRecommendations([]); });
    return () => { active = false; };
  }, [hasQuiz, user?.id, products]);

  // Listen for events from ProductModal's "similar items" click
  useEffect(() => {
    const handler = (e: CustomEvent) => setModalProduct(e.detail);
    window.addEventListener('open-product-modal', handler as EventListener);
    return () => window.removeEventListener('open-product-modal', handler as EventListener);
  }, []);

  // Deduped carousel feed: trending badges first, then the rest of the catalogue.
  const trendingProducts: Product[] = (() => {
    const seen = new Set<string>();
    const list: Product[] = [];
    [...trending, ...products].forEach(p => {
      if (!seen.has(p.id)) { seen.add(p.id); list.push(p); }
    });
    return list;
  })();

  const scrollTrending = (direction: -1 | 1) => {
    const el = trendingRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.85, 260), behavior: 'smooth' });
  };

  if (loading) return <LoadingState fullScreen message="Hang tight, loading the catalog…" />;
  if (error) return <div className="min-h-screen bg--background flex items-center justify-center p-6 text-center"><div><h1 className="font-display text-2xl mb-2">Catalog unavailable</h1><p className="text-sm text-muted-foreground">{error}</p></div></div>;

  return (
    <div className="storefront-theme min-h-screen bg-background">
      <CustomerNav />
      <ProductModal product={modalProduct} onClose={() => setModalProduct(null)} />

      {/* Hero */}
      <section className="bg-[var(--secondary)]">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-[1.05fr_0.95fr] md:gap-12 md:py-20">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">
              <Sparkles size={12} />
              Beauty Recommendations
            </div>
            <h1 className="mb-5 font-display text-4xl leading-tight text-[var(--foreground)] sm:text-5xl md:text-6xl">
              Your Skin,<br /><em className="text-[var(--primary)] not-italic">Your Story.</em>
            </h1>
            <p className="mb-8 max-w-md text-base leading-relaxed text-[var(--foreground)]/85 sm:text-lg">
              Discover P&G's science-backed beauty products tailored to your unique skin type, lifestyle, and preferences.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/quiz">
                <Button size="lg">Take Beauty Quiz <ArrowRight size={16} /></Button>
              </Link>
              <Link to="/for-you">
                <Button size="lg" variant="outline" className="!border-2 !border-[var(--foreground)] !bg-transparent !text-[var(--foreground)] hover:!bg-[var(--foreground)] hover:!text-white">Shop For You</Button>
              </Link>
            </div>
          </div>
          <div className="relative min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-white">
            <div className="relative w-full">
              <img
                src="https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=900&h=700&fit=crop&auto=format"
                alt="Beauty products"
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="absolute bottom-3 left-3 z-10 rounded-[var(--radius-inner)] border border-[var(--border)] bg-white/95 p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--secondary)]">
                    <Zap size={14} className="text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground">Personal Match</div>
                    <div className="text-[10px] text-muted-foreground">98% for your skin</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <div className="border-y border-border bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: <Truck size={16} />, label: 'Free Shipping', sub: 'On orders over ₱2,500' },
            { icon: <Shield size={16} />, label: 'Dermatologist Tested', sub: 'All products certified' },
            { icon: <Sparkles size={16} />, label: 'Personalized Picks', sub: 'Tailored to you' },
            { icon: <Zap size={16} />, label: 'Fast Delivery', sub: '2–5 business days' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-light text-primary flex items-center justify-center shrink-0">{item.icon}</div>
              <div>
                <div className="text-xs font-semibold text-foreground">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <h2 className="font-display text-3xl">Category</h2>
          <Link to="/category/all" className="group inline-flex shrink-0 items-center gap-2 rounded-full border-2 border-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
            All Products <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {categories.map(cat => (
            <Link key={cat.id} to="/category/all" className="group relative block h-44 overflow-hidden rounded-[var(--radius-xl)] bg-secondary transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:h-52 md:h-56">
              <img src={safeImage(cat.image, cat.name)} alt={cat.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h3 className="text-white font-semibold text-sm">{cat.name}</h3>
                <p className="text-white/90 text-xs">View all products</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Recommended for you — quiz gated */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[var(--primary)]">
              <Sparkles size={12} /> Recommended for you
            </div>
            <h2 className="font-display text-3xl">Picked For Your Skin</h2>
          </div>
          {hasQuiz && (
            <Link to="/for-you" className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full border-2 border-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:self-auto">
              View all <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
            </Link>
          )}
        </div>

        {hasQuiz ? (
          recommendations.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {recommendations.slice(0, 4).map(product => (
                <ProductCard key={product.id} product={product} onExpand={setModalProduct} />
              ))}
            </div>
          ) : (
            <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] bg-white p-6 text-sm text-[var(--muted-foreground)]">
              Building your recommendations… refresh this page in a moment if nothing appears.
            </div>
          )
        ) : (
          <div className="flex flex-col items-start gap-5 rounded-[var(--radius-xl)] border border-[var(--border)] bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h3 className="font-display text-2xl mb-2">Unlock your personalized picks</h3>
              <p className="max-w-lg text-sm leading-relaxed text-[var(--muted-foreground)]">
                {user
                  ? 'Answer our 2-minute beauty quiz and this shelf fills with products matched to your skin type, hair, and concerns.'
                  : 'Sign in and take our 2-minute beauty quiz to unlock a shelf of products matched to your skin type, hair, and concerns.'}
              </p>
            </div>
            <Link to={user ? '/quiz' : '/login'} className="shrink-0">
              <Button size="lg">
                {user ? 'Take Beauty Quiz' : 'Sign In to Start'} <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* Trending */}
      <section className="bg-rose-light/40 py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-medium text-primary tracking-widest uppercase mb-2">Don't Miss Out</div>
              <h2 className="font-display text-3xl">Trending & Almost Sold Out</h2>
            </div>
            <Link to="/category/all" className="group inline-flex shrink-0 items-center gap-2 self-start rounded-full border-2 border-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:self-auto">All Products <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></Link>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => scrollTrending(-1)}
              aria-label="Scroll trending products left"
              className="absolute -left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--foreground)] shadow-md transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:flex"
            >
              <ChevronLeft size={18} />
            </button>
            <div
              ref={trendingRef}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {trendingProducts.map(product => (
                <div key={product.id} className="w-[47%] shrink-0 snap-start sm:w-[31%] md:w-[23.5%] lg:w-[calc((100%-3rem)/4)]">
                  <ProductCard product={product} onExpand={setModalProduct} />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollTrending(1)}
              aria-label="Scroll trending products right"
              className="absolute -right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--foreground)] shadow-md transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:flex"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* Quiz CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[var(--radius-xl)] bg-[var(--primary)] p-6 sm:flex-row sm:items-center sm:p-10">
          <div className="text-white">
            <h2 className="font-display text-3xl md:text-4xl mb-3">Find Your Perfect Match</h2>
            <p className="text-white/80 max-w-md">Take our 2-minute beauty quiz and discover products matched to your skin type and concerns.</p>
          </div>
          <Link to="/quiz" className="shrink-0">
            <Button size="lg" variant="outline" className="!border-2 !border-white !bg-white !text-[var(--primary)] hover:!bg-transparent hover:!text-white">
              Start Quiz <ArrowRight size={16} />
            </Button>
          </Link>
        </div>
      </section>

      <CustomerFooter />
    </div>
  );
}
