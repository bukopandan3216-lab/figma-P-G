import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Heart, User, Search, Menu, X } from 'lucide-react';
import { useCart } from '../context/AppContext';
import { useCatalog } from '../context/CatalogContext';

export default function CustomerNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const { cartCount } = useCart();
  const { loading: catalogLoading } = useCatalog();
  const navigate = useNavigate();

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
                placeholder="Search products, brands…"
                className="flex-1 text-base outline-none bg-transparent"
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={18} /></button>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-2">
              {['Olay Moisturizer', 'Pantene Shampoo', 'SK-II Serum', 'Head & Shoulders'].map(s => (
                <button key={s} type="button" disabled={catalogLoading} onClick={() => { navigate(`/search?q=${encodeURIComponent(s)}`); setSearchOpen(false); }} className="text-xs px-3 py-1 rounded-full bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">{s}</button>
              ))}
            </div>
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
