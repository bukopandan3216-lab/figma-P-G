
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Heart, ShoppingBag, Star, ChevronLeft, ChevronRight, Truck, Check, ChevronDown } from 'lucide-react';
import { useCart } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import type { Product } from '../data/products';
import { useCatalog } from '../context/CatalogContext';
import { Badge, StarRating, Button } from './ui';
import { safeImage } from '../lib/image';
import { defaultVariantSelection, isVariantOptionAvailable, resolveVariant } from '../lib/variant';
import { supabase } from '../lib/supabase';

interface Props {
  product: Product | null;
  onClose: () => void;
}

interface ProductReview {
  id: string;
  rating: number;
  review: string;
  created_at: string;
}

export default function ProductModal({ product, onClose }: Props) {
  const [activeImg, setActiveImg] = useState(0);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [activeReviewFilter, setActiveReviewFilter] = useState<'All' | number>('All');
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewError, setReviewError] = useState('');
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewSaving, setReviewSaving] = useState(false);
  const { addToCart, wishlist, toggleWishlist } = useCart();
  const { user } = useAuth();
  const { products } = useCatalog();

  const similar = products.filter(p => p.category === product?.category && p.id !== product?.id).slice(0, 4);

  useEffect(() => {
    setActiveImg(0);
    setSelectedVariants({});
    setQty(1);
    setShowFullDesc(false);
    setActiveReviewFilter('All');
    setReviewText('');
    setReviewRating(5);
    setReviewNotice('');
  }, [product?.id]);

  useEffect(() => {
    if (!product) return;
    let active = true;
    setReviewsLoading(true);
    setReviewError('');
    setReviews([]);

    void supabase.from('product_reviews')
      .select('id:review_id, rating, review, created_at')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setReviewError('Reviews are temporarily unavailable. Please try again later.');
        else setReviews((data || []) as ProductReview[]);
        setReviewsLoading(false);
      }, () => {
        if (active) {
          setReviewError('Reviews are temporarily unavailable. Please try again later.');
          setReviewsLoading(false);
        }
      });

    return () => { active = false; };
  }, [product?.id]);

  useEffect(() => {
    if (!product) return;

    const previousOverflow = document.body.style.overflow;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previousOverflow;
    };
  }, [product, onClose]);

  // The gallery follows the selector's effective choice (explicit pick, else
  // the group's first option); variants without photos fall back to the
  // product's own gallery.
  const effectiveVariantLabel = product ? resolveVariant(product, selectedVariants).label || '' : '';
  useEffect(() => { setActiveImg(0); }, [effectiveVariantLabel]);

  if (!product) return null;

  const defaultSelection = defaultVariantSelection(product);

  const variantPhotos = (effectiveVariantLabel ? product.variantImages?.[effectiveVariantLabel] : undefined) || [];
  const imgs = (variantPhotos.length ? variantPhotos : product.images?.length ? product.images.filter(Boolean) : [product.image]).filter(Boolean);
  const safeImgs = imgs.length ? imgs.map(img => safeImage(img, product.name)) : [safeImage(product.image, product.name)];
  const selectedVariant = resolveVariant(product, selectedVariants);
  const canBuy = product.inStock && selectedVariant.valid && selectedVariant.stock > 0;
  const variantSavings = selectedVariant.originalPrice != null ? selectedVariant.originalPrice - selectedVariant.price : 0;
  const wished = wishlist.includes(product.id);
  const averageReviewRating = reviews.length
    ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
    : 0;
  const ratingBreakdown = [5, 4, 3, 2, 1].map(stars => ({
    stars,
    count: reviews.filter(review => review.rating === stars).length,
    label: '★'.repeat(stars),
  }));
  const visibleReviews = reviews.filter(review => activeReviewFilter === 'All' || review.rating === activeReviewFilter);

  const submitReview = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product || !user?.id) return;
    setReviewSaving(true);
    setReviewError('');
    setReviewNotice('');
    try {
      const { error } = await supabase.rpc('submit_product_review', {
        p_product_id: product.id,
        p_rating: reviewRating,
        p_review: reviewText.trim(),
      });
      if (error) throw error;

      const { data, error: refreshError } = await supabase.from('product_reviews')
        .select('id:review_id, rating, review, created_at')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false });
      if (refreshError) throw refreshError;

      setReviews((data || []) as ProductReview[]);
      setReviewText('');
      setReviewNotice('Your verified purchase review has been saved.');
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : 'Unable to save your review. Please try again.');
    } finally {
      setReviewSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-white shadow-2xl animate-fade-in">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3.5 top-3.5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-white/95 text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--foreground)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <X size={16} />
        </button>

        <div className="overflow-y-auto flex-1">
          {/* Top section: image gallery + product info */}
          <div className="flex flex-col md:flex-row gap-0">
            {/* Left: Thumbnail strip + main image */}
            <div className="md:w-[55%] flex flex-col sm:flex-row gap-0 bg-[var(--secondary)]">
              {/* Thumbnail strip */}
              {imgs.length > 1 && (
                <div className="flex sm:flex-col gap-2 p-3 sm:p-3 overflow-x-auto sm:overflow-y-auto scrollbar-hide sm:w-20 flex-shrink-0">
                  {safeImgs.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImg(i)}
                      className={`flex-shrink-0 w-14 h-14 sm:w-full sm:aspect-square rounded-lg overflow-hidden border-2 transition-all ${i === activeImg ? 'border-[var(--primary)]' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Main image */}
              <div className="relative flex-1 aspect-square sm:aspect-auto overflow-hidden">
                <img
                  src={safeImgs[activeImg]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
                {safeImgs.length > 1 && (
                  <div className="absolute bottom-3 right-3 flex gap-1">
                    <button onClick={() => setActiveImg(i => (i - 1 + safeImgs.length) % safeImgs.length)} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow text-sm hover:bg-white transition-colors"><ChevronLeft size={16} /></button>
                    <button onClick={() => setActiveImg(i => (i + 1) % safeImgs.length)} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow text-sm hover:bg-white transition-colors"><ChevronRight size={16} /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Product details */}
            <div className="md:w-[45%] flex flex-col p-5 sm:p-6 overflow-y-auto">
              {/* Breadcrumb */}
              <p className="text-xs text-[var(--muted-foreground)] mb-3">
                Home / {product.category} / <span className="text-[var(--foreground)]">{product.brand}</span>
              </p>

              {/* Rating */}
              <div className="mb-2 flex items-center gap-2">
                {reviews.length ? <>
                  <StarRating rating={averageReviewRating} />
                  <span className="text-sm font-medium text-[var(--foreground)]">{averageReviewRating.toFixed(1)}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">({reviews.length} reviews)</span>
                </> : <span className="text-xs text-[var(--muted-foreground)]">{reviewsLoading ? 'Loading reviews…' : 'No reviews yet'}</span>}
              </div>

              {/* Name */}
              <h2 className="font-display text-2xl leading-tight text-[var(--foreground)] mb-3">{product.name}</h2>

              {/* Price */}
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold">₱{selectedVariant.price.toFixed(2)}</span>
                {selectedVariant.originalPrice != null && (
                  <span className="text-base text-[var(--muted-foreground)] line-through">₱{selectedVariant.originalPrice.toFixed(2)}</span>
                )}
                {variantSavings > 0 && (
                  <Badge variant="danger">Save ₱{variantSavings.toFixed(2)}</Badge>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => addToCart({ id: product.id, name: product.name, brand: product.brand, price: selectedVariant.price, image: product.image, stock: selectedVariant.stock, inStock: canBuy, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label })}
                  disabled={!canBuy}
                  className="flex-1 border-2 border-[var(--primary)] text-[var(--primary)] font-semibold rounded-[var(--radius)] py-2.5 text-sm hover:bg-[var(--rose-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ShoppingBag size={15} /> Add to Cart
                </button>
                <button
                  onClick={() => addToCart({ id: product.id, name: product.name, brand: product.brand, price: selectedVariant.price, image: product.image, stock: selectedVariant.stock, inStock: canBuy, variantId: selectedVariant.variantId, variantLabel: selectedVariant.label })}
                  disabled={!canBuy}
                  className="flex-1 bg-[var(--primary)] text-white font-semibold rounded-[var(--radius)] py-2.5 text-sm hover:bg-[#9E5569] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Buy it now
                </button>
                <button
                  onClick={() => toggleWishlist(product.id)}
                  className={`w-11 rounded-[var(--radius)] border-2 flex items-center justify-center transition-all flex-shrink-0 ${wished ? 'border-[var(--primary)] bg-[var(--rose-light)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'}`}
                >
                  <Heart size={17} fill={wished ? 'currentColor' : 'none'} />
                </button>
              </div>

              {/* Variants (color swatches if multiple, or pill selectors) */}
              {product.variants?.map(variant => (
                <div key={variant.label} className="mb-4">
                  <div className="text-xs font-semibold mb-2 text-[var(--muted-foreground)] uppercase tracking-wide">
                    {variant.label}: <span className="text-[var(--foreground)] font-medium normal-case tracking-normal">{selectedVariants[variant.label] || defaultSelection[variant.label] || variant.options[0]}</span>
                  </div>
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
                          className={`px-3 py-1.5 rounded-full text-xs border-2 transition-all font-medium ${active ? 'border-[var(--primary)] bg-[var(--rose-light)] text-[var(--primary)]' : available ? 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/60' : 'border-[var(--border)] text-[var(--muted-foreground)] opacity-40 line-through cursor-not-allowed'}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Delivery */}
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] mb-4 py-3 border-t border-b border-[var(--border)]">
                <Truck size={14} className="text-[var(--primary)] flex-shrink-0" />
                <span>Free delivery on orders over ₱2,500 · 2–5 business days</span>
              </div>

              {/* Stock */}
              <div className={`flex items-center gap-2 text-sm mb-4 ${canBuy ? selectedVariant.stock < 10 ? 'text-amber-600' : 'text-emerald-600' : 'text-red-600'}`}>
                {canBuy ? (
                  <><Check size={14} />{selectedVariant.stock < 10 ? `Only ${selectedVariant.stock} left in stock — order soon!` : `In Stock (${selectedVariant.stock} units)`}</>
                ) : (
                  <><X size={14} />Currently out of stock</>
                )}
              </div>

              {/* Description */}
              <div className="mb-3">
                <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-1.5">Description:</p>
                <p className={`text-sm text-[var(--muted-foreground)] leading-relaxed ${!showFullDesc ? 'line-clamp-3' : ''}`}>
                  {product.description}
                </p>
                <button onClick={() => setShowFullDesc(s => !s)} className="text-xs text-[var(--primary)] mt-1 hover:underline">
                  {showFullDesc ? 'Show less' : 'See full description'}
                </button>
              </div>

              {/* Brand */}
              <div className="border-t border-[var(--border)] pt-3">
                <p className="text-xs text-[var(--muted-foreground)] mb-2">Brand:</p>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--primary)]">{product.brand[0]}</div>
                  <div>
                    <div className="text-sm font-semibold">{product.brand}</div>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }, (_, i) => <Star key={i} size={10} fill="#F59E0B" stroke="none" />)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Similar items */}
          {similar.length > 0 && (
            <div className="px-5 sm:px-6 py-5 border-t border-[var(--border)]">
              <h3 className="text-sm font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">Similar items:</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {similar.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      // Re-open modal for similar product — parent handles this via onClose + re-open
                      onClose();
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('open-product-modal', { detail: p }));
                      }, 100);
                    }}
                    className="group text-left"
                  >
                    <div className="aspect-square bg-[var(--secondary)] rounded-xl overflow-hidden mb-2">
                      <img src={safeImage(p.image, p.name)} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <p className="text-xs font-bold">₱{p.price.toFixed(2)}</p>
                    <p className="text-xs text-[var(--muted-foreground)] line-clamp-1">{p.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          <div className="px-5 sm:px-6 py-5 border-t border-[var(--border)]">
            <h3 className="text-base font-bold mb-4">Reviews</h3>

            {/* Rating summary */}
            <div className="flex items-start gap-6 mb-5">
              <div className="flex-shrink-0 text-center">
                <div className="text-5xl font-bold leading-none">{reviews.length ? averageReviewRating.toFixed(1) : '—'}</div>
                {reviews.length > 0 && <div className="mt-1.5 flex justify-center"><StarRating rating={averageReviewRating} /></div>}
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{reviews.length} reviews</p>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                {ratingBreakdown.map(r => (
                  <div key={r.stars} className="flex items-center gap-2 text-xs">
                    <span className="w-8 flex-shrink-0 text-right text-[var(--muted-foreground)]">{r.stars}★</span>
                    <div className="flex-1 h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${reviews.length ? (r.count / reviews.length) * 100 : 0}%` }} />
                    </div>
                    <span className="text-[var(--muted-foreground)] w-10 flex-shrink-0">({r.count.toLocaleString()})</span>
                  </div>
                ))}
              </div>
            </div>

            {reviews.length > 0 && <div className="mb-5 flex flex-wrap gap-2">
              {(['All', 5, 4, 3, 2, 1] as const).map(filter => {
                const count = filter === 'All' ? reviews.length : ratingBreakdown.find(row => row.stars === filter)?.count || 0;
                return <button key={filter} type="button" onClick={() => setActiveReviewFilter(filter)} aria-pressed={activeReviewFilter === filter} className={`rounded-full border px-3 py-1 text-xs transition-colors ${activeReviewFilter === filter ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]'}`}>
                  {filter === 'All' ? 'All' : `${filter} stars`} <span className="opacity-80">({count})</span>
                </button>;
              })}
            </div>}

            {reviewsLoading ? <p role="status" className="py-4 text-sm text-[var(--muted-foreground)]">Loading customer reviews…</p>
              : reviewError ? <p role="alert" className="py-4 text-sm text-red-600">{reviewError}</p>
                : visibleReviews.length ? <div className="flex flex-col gap-5">
                  {visibleReviews.map(review => (
                    <article key={review.id} className="border-t border-[var(--border)] pt-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5" aria-label={`${review.rating} out of 5 stars`}>
                            {Array.from({ length: 5 }, (_, index) => <Star key={index} size={13} fill={index < review.rating ? 'currentColor' : 'none'} className="text-amber-500" aria-hidden="true" />)}
                          </div>
                          <span className="text-xs font-semibold">Verified buyer</span>
                        </div>
                        <time className="text-xs text-[var(--muted-foreground)]" dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString()}</time>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">{review.review}</p>
                    </article>
                  ))}
                </div>
                : <p className="border-t border-[var(--border)] py-5 text-sm text-[var(--muted-foreground)]">{reviews.length ? 'No reviews match this rating.' : 'No customer reviews yet. Be the first to share feedback after a delivered order.'}</p>}

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <h4 className="mb-2 text-sm font-semibold">Write a review</h4>
              {user?.id ? <form onSubmit={event => void submitReview(event)} className="flex flex-col gap-3">
                <p className="text-xs text-[var(--muted-foreground)]">Reviews are available after your order has been delivered. You can update your existing review.</p>
                <div className="flex items-center gap-1" role="group" aria-label="Choose a rating">
                  {Array.from({ length: 5 }, (_, index) => {
                    const value = index + 1;
                    return <button key={value} type="button" onClick={() => setReviewRating(value)} aria-label={`${value} star${value === 1 ? '' : 's'}`} aria-pressed={reviewRating === value} className="rounded p-1 text-amber-500 hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"><Star size={20} fill={value <= reviewRating ? 'currentColor' : 'none'} /></button>;
                  })}
                </div>
                <textarea required minLength={10} maxLength={1200} value={reviewText} onChange={event => setReviewText(event.target.value)} placeholder="Share your experience (10–1200 characters)" rows={4} className="w-full resize-y rounded-[var(--radius-inner)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[var(--muted-foreground)]">{reviewText.length}/1200</span>
                  <Button type="submit" size="sm" loading={reviewSaving} disabled={reviewText.trim().length < 10}>Submit Review</Button>
                </div>
                {reviewError && <p role="alert" className="text-sm text-red-600">{reviewError}</p>}
                {reviewNotice && <p role="status" className="text-sm text-emerald-700">{reviewNotice}</p>}
              </form> : <p className="text-sm text-[var(--muted-foreground)]"><Link to="/login" className="font-medium text-[var(--primary)] underline">Sign in</Link> to leave a review after your order is delivered.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
