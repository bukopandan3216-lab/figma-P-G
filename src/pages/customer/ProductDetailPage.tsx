
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShoppingBag, Heart, ChevronLeft, ChevronRight, Star, Check, Truck, Shield, RotateCcw } from 'lucide-react';
import { useCatalog } from '../../context/CatalogContext';
import { useCart } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, StarRating, Tabs, Breadcrumb, LoadingState } from '../../components/ui';
import CustomerNav from '../../components/CustomerNav';
import { safeImage } from '../../lib/image';
import { supabase } from '../../lib/supabase';
import { recordCustomerInteraction } from '../../lib/recommendations';
import { FREE_SHIPPING_THRESHOLD } from '../../lib/catalog';
import { defaultVariantSelection, isVariantOptionAvailable, resolveVariant } from '../../lib/variant';

type DbReview = {
  id: string;
  rating: number;
  review: string;
  createdAt: string;
  reviewer: string;
};

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { products, loading, error } = useCatalog();
  const product = products.find(p => p.id === id);
  const { user } = useAuth();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [id]);
  useEffect(() => {
    if (!product || !user?.id) return;
    void recordCustomerInteraction(user.id, product.id, 'view').catch(cause => console.error('Unable to record product view:', cause));
  }, [product?.id, user?.id]);
  const [activeImg, setActiveImg] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('Description');
  const [qty, setQty] = useState(1);
  const [productReviews, setProductReviews] = useState<DbReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const { addToCart, wishlist, toggleWishlist } = useCart();

  // Reviews are read straight from product_reviews — products.rating/products.reviews
  // are kept in sync by the refresh_product_rating() trigger in the database.
  useEffect(() => {
    let active = true;
    setProductReviews([]);
    if (!id) {
      setReviewsLoading(false);
      return () => { active = false; };
    }
    setReviewsLoading(true);
    (async () => {
      try {
        // Reviewer names come from a product-scoped RPC that exposes only the
        // display-name columns. Embedding profiles() is blocked for guests and
        // filtered out for other customers, and it would expose reviewer emails.
        const [{ data, error }, authors] = await Promise.all([
          supabase
            .from('product_reviews')
            .select('review_id, user_id, rating, review, created_at')
            .eq('product_id', id)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase.rpc('get_product_review_authors', { p_product_id: id }),
        ]);
        if (!active) return;
        if (error) throw error;
        const names = new Map<string, string>(
          ((authors.data || []) as { user_id: string; first_name: string | null; last_name: string | null }[])
            .map(author => [author.user_id, [author.first_name, author.last_name].filter(Boolean).join(' ')]),
        );
        setProductReviews((data || []).map((row: any) => ({
          id: row.review_id,
          rating: Number(row.rating || 0),
          review: String(row.review || ''),
          createdAt: row.created_at || '',
          reviewer: names.get(row.user_id) || 'Beauty customer',
        })));
      } catch {
        if (active) setProductReviews([]);
      } finally {
        if (active) setReviewsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  // The gallery follows the selector's effective choice: an explicit pick for
  // a group, otherwise that group's first option (the auto-selected default).
  const effectiveVariantLabel = product ? resolveVariant(product, selectedVariants).label || '' : '';
  useEffect(() => { setActiveImg(0); }, [effectiveVariantLabel]);

  if (loading) return <LoadingState fullScreen message="Hang tight, loading product details…" />;
  if (error || !product) return <div className="min-h-screen bg-background flex items-center justify-center p-6 text-center"><p className="text-sm text-[var(--muted-foreground)]">{error || 'Product not found.'}</p></div>;
  const wished = wishlist.includes(product.id);
  // When the selected variant has its own photos they replace the product
  // gallery; otherwise the product's own photos are shown. product.images
  // defaults to '{}' (empty array, truthy in JS) rather than null, hence the
  // explicit length checks.
  const variantPhotos = (effectiveVariantLabel ? product.variantImages?.[effectiveVariantLabel] : undefined) || [];
  const imgs = (variantPhotos.length ? variantPhotos : product.images?.length ? product.images.filter(Boolean) : [product.image]).filter(Boolean);
  const safeImgs = imgs.length ? imgs.map(img => safeImage(img, product.name)) : [safeImage(product.image, product.name)];
  const relatedProducts = products.filter(p => p.category === product.category && p.id !== product.id).slice(0, 4);
  // Price, stock and the variant id all follow the shopper's selection, so the
  // cart line stores the SKU actually chosen and the price it was shown at.
  const defaultSelection = defaultVariantSelection(product);
  const selectedVariant = resolveVariant(product, selectedVariants);
  const variantStock = selectedVariant.stock;
  const canBuy = product.inStock && selectedVariant.valid && variantStock > 0;
  const variantOriginalPrice = selectedVariant.originalPrice;
  const savings = variantOriginalPrice != null ? variantOriginalPrice - selectedVariant.price : 0;

  return (
    <div className="min-h-screen bg-background">
      <CustomerNav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: product.category, href: `/category/${product.category.toLowerCase().replace(' ', '-')}` }, { label: product.name }]} />

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          {/* Image gallery */}
          <div className="flex flex-col gap-3">
            <div className="relative aspect-square bg-secondary rounded-radius-xl overflow-hidden">
              <img src={safeImgs[activeImg]} alt={product.name} className="w-full h-full object-cover" />
              {safeImgs.length > 1 && (
                <>
                  <button onClick={() => setActiveImg(i => (i - 1 + safeImgs.length) % safeImgs.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md hover:bg-white transition-colors"><ChevronLeft size={18} /></button>
                  <button onClick={() => setActiveImg(i => (i + 1) % safeImgs.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md hover:bg-white transition-colors"><ChevronRight size={18} /></button>
                </>
              )}
              {product.badge && <div className="absolute top-4 left-4"><Badge variant="rose">{product.badge}</Badge></div>}
            </div>
            {safeImgs.length > 1 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {safeImgs.map((img, i) => (
                  <button key={i} onClick={() => setActiveImg(i)} className={`shrink-0 w-16 h-16 rounded-radius overflow-hidden border-2 transition-all ${i === activeImg ? 'border-[var(--primary)]' : 'border-transparent hover:border-[var(--muted)]'}`}>
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="flex flex-col">
            <div className="text-sm font-medium text-[var(--primary)] mb-1">{product.brand}</div>
            <h1 className="font-display text-3xl text-[var(--foreground)] leading-tight mb-3">{product.name}</h1>
            <div className="flex items-center gap-3 mb-4">
              <StarRating rating={product.rating} />
              <span className="text-sm text-[var(--muted-foreground)]">{product.rating} ({product.reviews.toLocaleString()} reviews)</span>
            </div>

            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl font-bold">₱{selectedVariant.price.toFixed(2)}</span>
              {variantOriginalPrice != null && (
                <>
                  <span className="text-lg text-[var(--muted-foreground)] line-through">₱{variantOriginalPrice.toFixed(2)}</span>
                  {savings > 0 && <Badge variant="danger">Save ₱{savings.toFixed(2)}</Badge>}
                </>
              )}
            </div>

            {/* Stock status */}
            <div className={`flex items-center gap-2 mb-5 text-sm ${canBuy ? variantStock < 10 ? 'text-amber-600' : 'text-emerald-600' : 'text-red-600'}`}>
              {canBuy ? (
                <><Check size={14} /> {variantStock < 10 ? `Only ${variantStock} left in stock!` : 'In Stock'}</>
              ) : (
                <><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Out of Stock</>
              )}
            </div>

            {/* Variants */}
            {product.variants?.map(variant => (
              <div key={variant.label} className="mb-5">
                <div className="text-sm font-semibold mb-2">{variant.label}: <span className="font-normal text-[var(--muted-foreground)]">{selectedVariants[variant.label] || defaultSelection[variant.label] || variant.options[0]}</span></div>
                <div className="flex flex-wrap gap-2">
                  {variant.options.map(opt => {
                    const available = isVariantOptionAvailable(product, selectedVariants, variant.label, opt);
                    const active = (selectedVariants[variant.label] || defaultSelection[variant.label] || variant.options[0]) === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => setSelectedVariants(prev => ({ ...prev, [variant.label]: opt }))}
                        disabled={!available}
                        title={available ? undefined : 'This combination is not available'}
                        className={`px-4 py-1.5 rounded-full text-sm border-2 transition-all ${active ? 'border-[var(--primary)] text-[var(--primary)] font-medium' : available ? 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--muted-foreground)]' : 'border-[var(--border)] text-[var(--muted-foreground)] opacity-40 line-through cursor-not-allowed'}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Qty + Add to cart */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-9 h-10 flex items-center justify-center hover:bg-[var(--secondary)] transition-colors text-lg font-medium">−</button>
                <span className="w-10 text-center text-sm font-medium">{qty}</span>
                <button onClick={() => setQty(q => q + 1)} className="w-9 h-10 flex items-center justify-center hover:bg-[var(--secondary)] transition-colors text-lg font-medium">+</button>
              </div>
              <Button
                size="lg"
                className="flex-1"
                disabled={!canBuy || qty > variantStock}
                onClick={() => {
                  for (let i = 0; i < qty; i++) addToCart({ id: product.id, name: product.name, brand: product.brand, price: selectedVariant.price, image: product.image, stock: variantStock, inStock: canBuy, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label });
                }}
              >
                <ShoppingBag size={16} /> Add to Cart
              </Button>
              <button
                onClick={() => toggleWishlist(product.id)}
                className={`w-10 h-10 flex items-center justify-center rounded-[var(--radius)] border-2 transition-all ${wished ? 'border-[var(--primary)] bg-[var(--rose-light)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'}`}
              >
                <Heart size={18} fill={wished ? 'currentColor' : 'none'} />
              </button>
            </div>

            {/* Benefits */}
            <div className="flex flex-col gap-2 mt-4 p-4 bg-[var(--secondary)] rounded-[var(--radius-lg)]">
              {[
                { icon: <Truck size={14} />, text: `Free shipping on orders over ₱${FREE_SHIPPING_THRESHOLD.toLocaleString('en-PH')}` },
                { icon: <RotateCcw size={14} />, text: '30-day hassle-free returns' },
              ].map(item => (
                <div key={item.text} className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span className="text-[var(--primary)]">{item.icon}</span>{item.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-12">
          <Tabs tabs={['Description', 'How to Use', 'Ingredients', 'Reviews']} active={tab} onChange={setTab} />
          <div className="mt-6 p-2">
            {tab === 'Description' && (
              <div className="prose prose-sm max-w-2xl text-[var(--muted-foreground)] leading-relaxed">
                <p>{product.description}</p>
                <ul className="mt-4 flex flex-col gap-1.5">
                  {product.tags.map(tag => <li key={tag} className="flex items-center gap-2"><Check size={14} className="text-[var(--primary)]" /><span className="capitalize">{tag}</span></li>)}
                </ul>
              </div>
            )}
            {tab === 'How to Use' && (
              <div className="max-w-lg space-y-3">
                {['Apply a small amount to clean, dry skin', 'Massage gently in circular motions', 'Use morning and evening for best results', 'Follow with SPF during daytime use'].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm text-[var(--muted-foreground)]">
                    <span className="w-6 h-6 rounded-full bg-[var(--primary)] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                    {step}
                  </div>
                ))}
              </div>
            )}
            {tab === 'Ingredients' && (
              <p className="text-sm text-[var(--muted-foreground)] max-w-2xl leading-relaxed">Water, Glycerin, Niacinamide, Dimethicone, Cetyl Alcohol, Stearyl Alcohol, Glyceryl Stearate, PEG-100 Stearate, Tocopheryl Acetate, Carbomer, Sodium Hydroxide, Disodium EDTA, Methylparaben, Propylparaben.</p>
            )}
            {tab === 'Reviews' && (
              <div className="flex flex-col gap-6 max-w-2xl">
                <div className="flex flex-col gap-5 p-4 bg-[var(--secondary)] rounded-[var(--radius-lg)] sm:flex-row sm:items-center">
                  <div className="text-center shrink-0">
                    <div className="text-4xl font-bold font-display">{product.rating}</div>
                    <StarRating rating={product.rating} />
                    <div className="text-xs text-[var(--muted-foreground)] mt-1">{product.reviews.toLocaleString()} reviews</div>
                  </div>
                  {productReviews.length > 0 && (
                    <div className="flex flex-1 flex-col gap-1.5">
                      {[5, 4, 3, 2, 1].map(star => {
                        const count = productReviews.filter(review => review.rating === star).length;
                        const percent = Math.round((count / productReviews.length) * 100);
                        return (
                          <div key={star} className="flex items-center gap-2 text-xs">
                            <span className="w-6 text-[var(--muted-foreground)]">{star}★</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="w-5 text-right text-[var(--muted-foreground)]">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {reviewsLoading ? (
                  <p className="text-sm text-[var(--muted-foreground)]">Loading reviews…</p>
                ) : productReviews.length ? (
                  productReviews.map(review => (
                    <div key={review.id} className="flex flex-col gap-2 border-b border-[var(--border)] pb-5 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-bold flex items-center justify-center">{review.reviewer[0]?.toUpperCase() || 'B'}</div>
                          <span className="text-sm font-medium">{review.reviewer}</span>
                        </div>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {review.createdAt ? new Date(review.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                        </span>
                      </div>
                      <StarRating rating={review.rating} />
                      <p className="text-sm text-[var(--muted-foreground)]">{review.review}</p>
                    </div>
                  ))
                ) : (
                  <div className="border border-dashed border-[var(--border)] rounded-[var(--radius-lg)] p-6 text-sm text-[var(--muted-foreground)]">
                    No reviews yet for this product. Be the first to share your experience.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* You may also like */}
        {relatedProducts.length > 0 && (
          <div className="mt-14">
            <h2 className="font-display text-2xl mb-6">You May Also Like</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {relatedProducts.map(p => (
                <Link key={p.id} to={`/product/${p.id}`} className="group bg-white rounded-[var(--radius-xl)] border border-[var(--border)] overflow-hidden hover:shadow-md transition-all">
                  <div className="aspect-square bg-[var(--secondary)] overflow-hidden">
                    <img src={safeImage(p.image, p.name)} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="p-3">
                    <div className="text-[10px] text-[var(--muted-foreground)] mb-0.5">{p.brand}</div>
                    <div className="text-sm font-semibold line-clamp-2 leading-snug">{p.name}</div>
                    <div className="text-sm font-bold mt-1">₱{p.price.toFixed(2)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky ATC bar (mobile) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--border)] p-4 flex items-center gap-3 md:hidden z-30">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[var(--muted-foreground)] truncate">{product.name}{selectedVariant.label ? ` · ${selectedVariant.label}` : ''}</div>
          <div className="font-bold">₱{selectedVariant.price.toFixed(2)}</div>
        </div>
        <Button disabled={!canBuy} onClick={() => addToCart({ id: product.id, name: product.name, brand: product.brand, price: selectedVariant.price, image: product.image, stock: variantStock, inStock: canBuy, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label })}>
          <ShoppingBag size={15} /> Add to Cart
        </Button>
      </div>
    </div>
  );
}
