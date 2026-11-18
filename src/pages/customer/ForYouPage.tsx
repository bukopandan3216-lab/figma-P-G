import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Heart } from 'lucide-react';
import { useCatalog } from '../../context/CatalogContext';
import { useAuth } from '../../context/AuthContext';
import { recommendProducts, recordCustomerInteraction, type ScoredRecommendation } from '../../lib/recommendations';
import { useCart } from '../../context/AppContext';
import { Button, StarRating, Badge, LoadingState } from '../../components/ui';
import CustomerNav from '../../components/CustomerNav';
import { safeImage } from '../../lib/image';
import { resolveVariant } from '../../lib/variant';

export default function ForYouPage() {
  const navigate = useNavigate();
  const { addToCart, wishlist, toggleWishlist } = useCart();
  const { products, loading, error } = useCatalog();
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<ScoredRecommendation[]>([]);
  const [recommendationLoading, setRecommendationLoading] = useState(true);
  const [recommendationError, setRecommendationError] = useState('');
  const [browsingOffset, setBrowsingOffset] = useState(0);
  const BROWSING_PAGE_SIZE = 8;

  useEffect(() => {
    let active = true;
    if (loading) return () => { active = false; };
    const hasQuiz = Boolean(user?.skinProfile && Object.keys(user.skinProfile).length > 0);
    if (error || !products.length || !user?.id || !hasQuiz) {
      setRecommendationLoading(false);
      setRecommendations([]);
      return () => { active = false; };
    }

    setRecommendationLoading(true);
    setRecommendationError('');
    void recommendProducts(user.id, products).then(results => {
      if (active) { setRecommendations(results); setRecommendationError(''); }
    }).catch(cause => {
      if (active) setRecommendationError(cause instanceof Error ? cause.message : 'Unable to load recommendations.');
    }).finally(() => {
      if (active) setRecommendationLoading(false);
    });
    return () => { active = false; };
  }, [products, loading, error, user?.id, user?.skinProfile]);
  const topRecommendation = recommendations[0];
  const topPick = topRecommendation?.product;
  const hasQuiz = Boolean(user?.skinProfile && Object.keys(user.skinProfile).length > 0);

  if (loading || (hasQuiz && recommendationLoading)) return <LoadingState fullScreen message="Hang tight, your recommendations are on their way…" />;

  if (!hasQuiz) return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />
      <section className="bg-[var(--secondary)] py-10 sm:py-14">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h1 className="font-display text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">Curated Just for You</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
              Ranked from your saved beauty preferences, product interests, and shopping history.
            </p>
          </div>
        </div>
      </section>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
        <div className="flex flex-col items-start gap-5 rounded-[var(--radius-xl)] border border-[var(--border)] bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[var(--primary)]">
              <Sparkles size={12} /> Beauty Quiz required
            </div>
            <h2 className="font-display text-2xl mb-2">Tell us about your skin first</h2>
            <p className="max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)]">
              Your answers — skin type, concerns, hair and body preferences — drive every ranking on this page. It takes about 2 minutes.
            </p>
          </div>
          <Link to="/quiz" className="shrink-0"><Button size="lg">Take Beauty Quiz <ArrowRight size={16} /></Button></Link>
        </div>
      </div>
    </div>
  );

  if (error || recommendationError || !topPick) return <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6 text-center"><p className="text-sm text-[var(--muted-foreground)]">{error || recommendationError || 'No recommendations available yet.'}</p></div>;

  const trackRecommendationClick = (recommendation: ScoredRecommendation) => {
    void recordCustomerInteraction(user?.id, recommendation.product.id, 'recommendation_clicked', recommendation.recommendationId)
      .catch(cause => console.error('Unable to record recommendation interaction:', cause));
  };

  const browsingProducts = products.slice(browsingOffset, browsingOffset + BROWSING_PAGE_SIZE);
  const hasMoreBrowsing = browsingOffset + BROWSING_PAGE_SIZE < products.length;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <CustomerNav />

      <section className="bg-[var(--secondary)] py-10 sm:py-14">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h1 className="font-display text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">Curated Just for You</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
              Ranked from your saved beauty preferences, product interests, and shopping history.
            </p>
          </div>
          <Link to="/quiz" className="shrink-0"><Button variant="outline">Retake Quiz <ArrowRight size={16} /></Button></Link>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* Top Pick */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-[var(--primary)]" />
            <h2 className="font-semibold">Your #1 Match</h2>
          </div>
          <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] overflow-hidden flex flex-col sm:flex-row">
            <div className="w-full aspect-square sm:h-48 sm:w-48 bg-[var(--secondary)] flex-shrink-0 overflow-hidden">
              <img src={safeImage(topPick.image, topPick.name)} alt={topPick.name} className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
            </div>
            <div className="p-6 flex flex-col justify-center flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="rose">Top Match · {topRecommendation.score.toFixed(1)}</Badge>
                {topPick.badge && <Badge variant="success">{topPick.badge}</Badge>}
              </div>
              <div className="text-sm text-[var(--muted-foreground)] mb-1">{topPick.brand}</div>
              <h3 className="font-display text-2xl mb-2">{topPick.name}</h3>
              <StarRating rating={topPick.rating} />
              <p className="text-sm text-[var(--muted-foreground)] mt-2 mb-4 max-w-lg">{topPick.description}</p>
              <p className="text-xs text-[var(--muted-foreground)] mb-4">{topRecommendation.reason}</p>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">₱{resolveVariant(topPick).price.toFixed(2)}</span>
                <Button onClick={() => { trackRecommendationClick(topRecommendation); addToCart({ id: topPick.id, name: topPick.name, brand: topPick.brand, price: resolveVariant(topPick).price, image: topPick.image, stock: resolveVariant(topPick).stock, inStock: topPick.inStock && resolveVariant(topPick).stock > 0, variantId: resolveVariant(topPick).variantId, variantLabel: resolveVariant(topPick).label }); }}>Add to Cart</Button>
                <Link to={`/product/${topPick.id}`} onClick={() => trackRecommendationClick(topRecommendation)}><Button variant="outline">View Details</Button></Link>
              </div>
            </div>
          </div>
        </div>

        {/* More Recommendations - 4x2 layout */}
        <div>
          <h2 className="font-display text-2xl mb-6">More Recommendations</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recommendations.slice(1, 9).map((recommendation, idx) => {
              const product = recommendation.product;
              const wished = wishlist.includes(product.id);
              return (
                <div
                  key={product.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => { trackRecommendationClick(recommendation); navigate(`/product/${product.id}`); }}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/product/${product.id}`); } }}
                  className="group bg-white rounded-[var(--radius-xl)] border border-[var(--border)] overflow-hidden transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="relative aspect-square overflow-hidden bg-[var(--secondary)]">
                    <img src={safeImage(product.image, product.name)} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute top-2 left-2"><Badge variant="rose" className="text-[10px]">Score {recommendation.score.toFixed(1)}</Badge></div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleWishlist(product.id); }}
                      aria-label={`${wished ? 'Remove' : 'Add'} ${product.name} ${wished ? 'from' : 'to'} wishlist`}
                      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow-sm transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      <Heart size={16} fill={wished ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="p-3">
                    <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">{product.brand}</div>
                    <span className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 group-hover:text-[var(--primary)] transition-colors leading-snug">{product.name}</span>
                    <div className="flex items-center gap-1 mt-1">
                      <StarRating rating={product.rating} />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-bold">₱{resolveVariant(product).price.toFixed(2)}</span>
                      <Button size="sm" onClick={event => { event.stopPropagation(); trackRecommendationClick(recommendation); addToCart({ id: product.id, name: product.name, brand: product.brand, price: resolveVariant(product).price, image: product.image, stock: resolveVariant(product).stock, inStock: product.inStock && resolveVariant(product).stock > 0, variantId: resolveVariant(product).variantId, variantLabel: resolveVariant(product).label }); }} disabled={!product.inStock || resolveVariant(product).stock <= 0} className="text-xs px-2.5">Add</Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {recommendations.slice(1, 9).length === 0 && <p className="text-sm text-[var(--muted-foreground)] text-center py-8">No more recommendations available.</p>}
          </div>
        </div>

        {/* Browsing section */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-2xl">Browse All Products</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={browsingOffset === 0} onClick={() => setBrowsingOffset(0)}>First</Button>
              <Button variant="outline" size="sm" disabled={browsingOffset === 0} onClick={() => setBrowsingOffset(Math.max(0, browsingOffset - BROWSING_PAGE_SIZE))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={!hasMoreBrowsing} onClick={() => setBrowsingOffset(browsingOffset + BROWSING_PAGE_SIZE)}>Next</Button>
              <Button variant="outline" size="sm" disabled={!hasMoreBrowsing} onClick={() => setBrowsingOffset(Math.max(0, products.length - BROWSING_PAGE_SIZE))}>Last</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {browsingProducts.map(product => {
              const wished = wishlist.includes(product.id);
              return (
                <div
                  key={product.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/product/${product.id}`)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/product/${product.id}`); } }}
                  className="group bg-white rounded-[var(--radius-xl)] border border-[var(--border)] overflow-hidden transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="relative aspect-square overflow-hidden bg-[var(--secondary)]">
                    <img src={safeImage(product.image, product.name)} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    {product.badge && <div className="absolute top-2 left-2"><Badge variant="rose" className="text-[10px]">{product.badge}</Badge></div>}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleWishlist(product.id); }}
                      aria-label={`${wished ? 'Remove' : 'Add'} ${product.name} ${wished ? 'from' : 'to'} wishlist`}
                      className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow-sm transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      <Heart size={16} fill={wished ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="p-3">
                    <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">{product.brand}</div>
                    <span className="text-sm font-semibold text-[var(--foreground)] line-clamp-2 group-hover:text-[var(--primary)] transition-colors leading-snug">{product.name}</span>
                    <div className="flex items-center gap-1 mt-1">
                      <StarRating rating={product.rating} />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-bold">₱{resolveVariant(product).price.toFixed(2)}</span>
                      <Button size="sm" onClick={event => { event.stopPropagation(); addToCart({ id: product.id, name: product.name, brand: product.brand, price: resolveVariant(product).price, image: product.image, stock: resolveVariant(product).stock, inStock: product.inStock && resolveVariant(product).stock > 0, variantId: resolveVariant(product).variantId, variantLabel: resolveVariant(product).label }); }} disabled={!product.inStock || resolveVariant(product).stock <= 0} className="text-xs px-2.5">Add</Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {browsingProducts.length === 0 && <p className="text-sm text-[var(--muted-foreground)] text-center py-8">No more products to browse.</p>}
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">Showing {browsingOffset + 1}–{Math.min(browsingOffset + browsingProducts.length, products.length)} of {products.length} products</p>
        </div>
      </div>
    </div>
  );
}
