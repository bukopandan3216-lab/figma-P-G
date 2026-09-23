import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

export interface CartItem {
  id: string;
  name: string;
  brand: string;
  price: number;
  image: string;
  qty: number;
  stock?: number;
  inStock?: boolean;
  variant?: string;
}

interface AppCtx {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'qty'>) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  cartCount: number;
  cartTotal: number;
  wishlist: string[];
  toggleWishlist: (id: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const readLocalData = () => {
    try {
      const savedCart = localStorage.getItem('pgbeauty-cart');
      const savedWishlist = localStorage.getItem('pgbeauty-wishlist');
      return {
        cart: savedCart ? (JSON.parse(savedCart) as CartItem[]) : [],
        wishlist: savedWishlist ? (JSON.parse(savedWishlist) as string[]) : [],
      };
    } catch {
      return { cart: [] as CartItem[], wishlist: [] as string[] };
    }
  };

  const [cart, setCart] = useState<CartItem[]>(() => readLocalData().cart);
  const [wishlist, setWishlist] = useState<string[]>(() => readLocalData().wishlist);
  const { user } = useAuth();

  const persistLocalData = (nextCart: CartItem[], nextWishlist: string[]) => {
    try {
      localStorage.setItem('pgbeauty-cart', JSON.stringify(nextCart));
      localStorage.setItem('pgbeauty-wishlist', JSON.stringify(nextWishlist));
    } catch {
      // Ignore storage quota issues.
    }
  };

  const mergeCart = (serverCart: CartItem[], guestCart: CartItem[]) => {
    const merged = new Map<string, CartItem>();
    [...guestCart, ...serverCart].forEach((item) => {
      const existing = merged.get(item.id);
      if (existing) {
        merged.set(item.id, {
          ...existing,
          ...item,
          qty: existing.qty + item.qty,
          price: item.price || existing.price,
        });
      } else {
        merged.set(item.id, { ...item });
      }
    });
    return Array.from(merged.values());
  };

  useEffect(() => {
    const localData = readLocalData();
    if (user) {
      let cancelled = false;

      void Promise.all([
        supabase.from('cart_items').select('product_id, quantity, variant_id, products(id, name, price, image, brands(name))').eq('user_id', user.id),
        supabase.from('wishlist_items').select('product_id').eq('user_id', user.id),
      ]).then(([cartResult, wishlistResult]) => {
        if (cancelled) return;

        const serverCart = (cartResult.data || []).map((row: any) => ({
          id: row.product_id,
          name: row.products?.name || 'Product',
          brand: row.products?.brands?.name || '',
          price: Number(row.products?.price || 0),
          image: row.products?.image || '',
          qty: Number(row.quantity || 0),
          variant: row.variant_id || undefined,
        }));
        const serverWishlist = (wishlistResult.data || []).map((row: any) => row.product_id);

        if (serverCart.length || serverWishlist.length) {
          const mergedCart = mergeCart(serverCart, localData.cart);
          const mergedWishlist = Array.from(new Set([...localData.wishlist, ...serverWishlist]));
          setCart(mergedCart);
          setWishlist(mergedWishlist);
          persistLocalData(mergedCart, mergedWishlist);
        } else {
          setCart(localData.cart);
          setWishlist(localData.wishlist);
        }
      }).catch(() => {
        if (!cancelled) {
          setCart(localData.cart);
          setWishlist(localData.wishlist);
        }
      });

      return () => {
        cancelled = true;
      };
    }

    setCart(localData.cart);
    setWishlist(localData.wishlist);
  }, [user?.id]);

  useEffect(() => {
    persistLocalData(cart, wishlist);
  }, [cart, wishlist]);

  const addToCart = (item: Omit<CartItem, 'qty'>) => {
    const stockLimit = typeof item.stock === 'number' ? item.stock : 0;
    if (!Number.isFinite(stockLimit) || stockLimit <= 0) return;

    const existing = cart.find(i => i.id === item.id);
    if (existing && typeof existing.stock === 'number' && existing.qty >= existing.stock) return;
    if (existing && typeof item.stock === 'number' && existing.qty + 1 > item.stock) return;

    const nextQuantity = (existing?.qty || 0) + 1;
    const nextCart = existing
      ? cart.map(i => i.id === item.id ? { ...i, qty: i.qty + 1, stock: i.stock ?? item.stock, inStock: (i.stock ?? item.stock ?? 0) > 0 } : i)
      : [...cart, { ...item, qty: 1, stock: item.stock, inStock: item.inStock ?? (item.stock ?? 0) > 0 }];

    setCart(nextCart);
    persistLocalData(nextCart, wishlist);

    if (user) void supabase.from('cart_items').upsert({
      user_id: user.id,
      product_id: item.id,
      quantity: nextQuantity,
      variant_id: item.variant || existing?.variant || null,
    }, { onConflict: 'user_id,product_id' });
  };
  const removeFromCart = (id: string) => {
    const nextCart = cart.filter(i => i.id !== id);
    setCart(nextCart);
    persistLocalData(nextCart, wishlist);
    if (user) void supabase.from('cart_items').delete().eq('user_id', user.id).eq('product_id', id);
  };
  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(id);
      return;
    }

    const nextCart = cart.map(i => i.id === id ? { ...i, qty } : i);
    setCart(nextCart);
    persistLocalData(nextCart, wishlist);

    if (user) void supabase.from('cart_items').update({ quantity: qty, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('product_id', id);
  };
  const toggleWishlist = (id: string) => {
    const exists = wishlist.includes(id);
    const nextWishlist = exists ? wishlist.filter(w => w !== id) : [...wishlist, id];
    setWishlist(nextWishlist);
    persistLocalData(cart, nextWishlist);

    if (user) {
      if (exists) void supabase.from('wishlist_items').delete().eq('user_id', user.id).eq('product_id', id);
      else void supabase.from('wishlist_items').insert({ user_id: user.id, product_id: id });
    }
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <Ctx.Provider value={{ cart, addToCart, removeFromCart, updateQty, cartCount, cartTotal, wishlist, toggleWishlist }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart outside AppProvider');
  return ctx;
}
