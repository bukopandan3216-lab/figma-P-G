import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Heart, User, Search, Menu, X } from 'lucide-react';
import { useCart } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { fetchSearchSuggestions, type SearchSuggestion } from '../lib/searchSuggestions';
import { safeImage } from '../lib/image';

export default function CustomerNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const { cartCount } = useCart();
  const { user } = useAuth();
  const { products, loading: catalogLoading } = useCatalog();
  const navigate = useNavigate();

  useEffect(() => {
    if (!searchOpen) return;
    let active = true;
    setSuggestionsLoading(true);
    fetchSearchSuggestions(5)
      .then(next => { if (active) setSuggestions(next); })
      .catch(() => { if (active) setSuggestions([]); })
      .finally(() => { if (active) setSuggestionsLoading(false); });
    return () => { active = false; };
  }, [searchOpen, user?.id]);

  const searchQuery = searchQ.trim().toLowerCase();

  const matchingProducts = useMemo(() => {
    if (!searchQuery) return [];
    return products
      .filter(product => (product.status ?? 'Active') === 'Active')
      .filter(product => [
        product.name,
        product.brand,
        product.category,
        ...(product.tags || []),
      ].some(value => value.toLowerCase().includes(searchQuery)))
      .slice(0, 8);
  }, [products, searchQuery]);

  const frequentSuggestions = suggestions.filter(suggestion => suggestion.section === 'frequent').slice(0, 5);
  const topSellingSuggestions = suggestions.filter(suggestion => suggestion.section === 'top_selling').slice(0, 5);

  const openSuggestion = (productId: string) => {
    navigate(`/product/${productId}`);
    setSearchOpen(false);
    setSearchQ('');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (catalogLoading) return;
    if (searchQ.trim()) { navigate(`/search?q=${encodeURIComponent(searchQ)}`); setSearchOpen(false); setSearchQ(''); }
  };

  const navLinks = [
    { label: 'Skin Care', href: '/category/skin-care' },
    { label: 'Hair Care', href: '/category/hair-care' },
    { label: 'Personal & Body Care', href: '/category/personal-body-care' },
    { label: 'For You', href: '/for-you' },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 flex-shrink-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--primary)] font-display text-lg font-bold text-white">
                P
              </div>
              <span className="font-display text-xl text-[var(--foreground)]">P&G Beauty</span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-6">
              {navLinks.map(l => (
                <Link key={l.href} to={l.href} className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button aria-label="Search products" title={catalogLoading ? 'Catalog is still loading…' : 'Search products'} disabled={catalogLoading} onClick={() => setSearchOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed">
                <Search size={18} />
              </button>
              <Link aria-label="Wishlist" to="/wishlist" className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                <Heart size={18} />
              </Link>
              <Link aria-label="Account" to="/account" className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                <User size={18} />
              </Link>
              <Link aria-label={`Shopping bag${cartCount > 0 ? `, ${cartCount} items` : ''}`} to="/cart" className="relative flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                <ShoppingBag size={18} />
                {cartCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--primary)] text-white text-[10px] font-bold flex items-center justify-center">{cartCount}</span>
                )}
              </Link>
              <button aria-label="Open menu" onClick={() => setMenuOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] md:hidden">
                <Menu size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-20 px-4">
          <form onSubmit={handleSearch} className="w-full max-w-xl bg-white rounded-[var(--radius-xl)] shadow-2xl p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <Search size={18} className="text-[var(--muted-foreground)] flex-shrink-0" />
              <input
                autoFocus
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search products, brands, tags…"
                className="flex-1 text-base outline-none bg-transparent"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={18} /></button>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] max-h-[56vh] overflow-y-auto">
              {suggestionsLoading && !searchQuery ? (
                <p className="px-2 py-4 text-sm text-[var(--muted-foreground)]">Loading suggestions...</p>
              ) : (
                <div className="space-y-4">
                  {searchQuery ? (
                    matchingProducts.length > 0 ? (
                      <div>
                        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">Matching Products</p>
                        <p className="px-2 text-xs text-[var(--muted-foreground)]">Matched by name, brand, category, or tag</p>
                        <div className="mt-2 space-y-1">
                          {matchingProducts.map(product => {
                            const matchedTags = (product.tags || []).filter(tag =>
                              tag.includes(searchQuery)
                            );
                            return (
                              <button key={product.id} type="button" onClick={() => openSuggestion(product.id)} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2 py-2 text-left transition-colors hover:bg-[var(--secondary)]">
                                <img src={safeImage(product.image, product.name)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">{product.name}</span>
                                  <span className="block truncate text-xs text-[var(--muted-foreground)]">{product.brand}</span>
                                  {matchedTags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                      {matchedTags.map(tag => (
                                        <span key={tag} className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-[10px] text-[var(--foreground)]">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="px-2 py-4 text-sm text-[var(--muted-foreground)]">No matching products. Press Enter to search all products.</p>
                    )
                  ) : (
                    <>
                      {frequentSuggestions.length > 0 && (
                        <div>
                          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">Frequently Interacted-With Products</p>
                          <p className="px-2 text-xs text-[var(--muted-foreground)]">Based on your recent activity</p>
                          <div className="mt-2 space-y-1">
                            {frequentSuggestions.map(suggestion => (
                              <button key={`frequent-${suggestion.product_id}`} type="button" onClick={() => openSuggestion(suggestion.product_id)} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2 py-2 text-left transition-colors hover:bg-[var(--secondary)]">
                                <img src={safeImage(suggestion.image, suggestion.name)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">{suggestion.name}</span>
                                  {suggestion.brand_name && <span className="block truncate text-xs text-[var(--muted-foreground)]">{suggestion.brand_name}</span>}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {topSellingSuggestions.length > 0 && (
                        <div>
                          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground)]">Top-Selling Beauty Products</p>
                          <p className="px-2 text-xs text-[var(--muted-foreground)]">What shoppers are buying most</p>
                          <div className="mt-2 space-y-1">
                            {topSellingSuggestions.map(suggestion => (
                              <button key={`top-${suggestion.product_id}`} type="button" onClick={() => openSuggestion(suggestion.product_id)} className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2 py-2 text-left transition-colors hover:bg-[var(--secondary)]">
                                <img src={safeImage(suggestion.image, suggestion.name)} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">{suggestion.name}</span>
                                  {suggestion.brand_name && <span className="block truncate text-xs text-[var(--muted-foreground)]">{suggestion.brand_name}</span>}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {frequentSuggestions.length === 0 && topSellingSuggestions.length === 0 && (
                        <p className="px-2 py-4 text-sm text-[var(--muted-foreground)]">No suggestions yet. Press Enter to search all products.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {searchQ.trim() && (
              <button type="submit" className="mt-3 w-full rounded-[var(--radius)] bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Search all products for "{searchQ.trim()}"
              </button>
            )}
          </form>
        </div>
      )}

      {/* Mobile menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[110] flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="relative w-72 bg-white h-full shadow-2xl flex flex-col p-6 animate-slide-in">
            <button onClick={() => setMenuOpen(false)} className="self-end mb-6 text-[var(--muted-foreground)]"><X size={20} /></button>
            <nav className="flex flex-col gap-1">
              {navLinks.map(l => (
                <Link key={l.href} to={l.href} onClick={() => setMenuOpen(false)} className="px-3 py-3 rounded-[var(--radius)] text-[var(--foreground)] font-medium hover:bg-[var(--secondary)] transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto pt-6 border-t border-[var(--border)] flex flex-col gap-2">
              <Link to="/account" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><User size={16} />My Account</Link>
              <Link to="/orders" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ShoppingBag size={16} />Orders</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
