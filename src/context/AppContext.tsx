import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { recordCustomerInteraction } from '../lib/recommendations';

export interface CartItem {
  // id = product id; variantId narrows it to one SKU of that product.
  id: string;
  // key = id + variantId. A cart can hold two variants of the same product, so
  // every lookup must use this key instead of the bare product id.
  key: string;
  name: string;
  brand: string;
  price: number;
  image: string;
  qty: number;
  stock?: number;
  inStock?: boolean;
  variantId?: string;
  variantLabel?: string;
}

interface AppCtx {
  cart: CartItem[];
  // Every cart line must name the exact SKU, so the same product can be bought
  // in two variants without the price/stock of one leaking into the other.
  addToCart: (item: Omit<CartItem, 'qty' | 'key' | 'variantId'> & { variantId: string }) => void;
  removeFromCart: (key: string) => void;
  updateQty: (key: string, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
  wishlist: string[];
  toggleWishlist: (id: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export const cartKey = (id: string, variantId?: string | null) => (variantId ? `${id}::${variantId}` : id);

// Rows saved by older builds have no key and used `variant` as the variant id.
const normalizeItem = (item: Partial<CartItem> & { id: string; variant?: string }): CartItem => {
  const variantId = item.variantId || item.variant || undefined;
  return {
    ...item,
    variantId,
    key: item.key || cartKey(item.id, variantId),
  } as CartItem;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const readLocalData = () => {
    try {
      const savedCart = localStorage.getItem('pgbeauty-cart');
      const savedWishlist = localStorage.getItem('pgbeauty-wishlist');
      const parsed = savedCart ? (JSON.parse(savedCart) as (Partial<CartItem> & { id: string; variant?: string })[]) : [];
      return {
        cart: parsed.filter(item => item && item.id).map(normalizeItem),
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
      const existing = merged.get(item.key);
      if (existing) {
        merged.set(item.key, {
          ...existing,
          ...item,
          qty: existing.qty + item.qty,
          price: item.price || existing.price,
        });
      } else {
        merged.set(item.key, { ...item });
      }
    });
    return Array.from(merged.values());
  };

  useEffect(() => {
    const localData = readLocalData();
    if (user) {
      let cancelled = false;

      void Promise.all([
        supabase.from('cart_items').select('product_id, quantity, variant_id, products(id:product_id, name, price, image, brands(name)), product_variants(size)').eq('user_id', user.id),
        supabase.from('wishlist_items').select('product_id').eq('user_id', user.id),
      ]).then(([cartResult, wishlistResult]) => {
        if (cancelled) return;

        const serverCart = (cartResult.data || []).map((row: any) => {
          const variant = Array.isArray(row.product_variants) ? row.product_variants[0] : row.product_variants;
          return normalizeItem({
            id: row.product_id,
            name: row.products?.name || 'Product',
            brand: row.products?.brands?.name || '',
            price: Number(row.products?.price || 0),
            image: row.products?.image || '',
            qty: Number(row.quantity || 0),
            variantId: row.variant_id || undefined,
            variantLabel: variant?.size || undefined,
          });
        });
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

  // cart_items has one row per (user, product, variant). Supabase cannot target
  // the expression unique index from onConflict, so replace the matching row.
  const replaceServerRow = async (item: CartItem, quantity: number) => {
    if (!user) return;
    let removeQuery = supabase.from('cart_items').delete().eq('user_id', user.id).eq('product_id', item.id);
    removeQuery = item.variantId ? removeQuery.eq('variant_id', item.variantId) : removeQuery.is('variant_id', null);
    await removeQuery;
    await supabase.from('cart_items').insert({
      user_id: user.id,
      product_id: item.id,
      variant_id: item.variantId || null,
      quantity,
    });
  };

  const deleteServerRow = async (item: CartItem) => {
    if (!user) return;
    let query = supabase.from('cart_items').delete().eq('user_id', user.id).eq('product_id', item.id);
    query = item.variantId ? query.eq('variant_id', item.variantId) : query.is('variant_id', null);
    await query;
  };

  const addToCart = (item: Omit<CartItem, 'qty' | 'key' | 'variantId'> & { variantId: string }) => {
    if (!item.variantId) return;
    const stockLimit = typeof item.stock === 'number' ? item.stock : 0;
    if (!Number.isFinite(stockLimit) || stockLimit <= 0) return;

    const key = cartKey(item.id, item.variantId);
    const existing = cart.find(i => i.key === key);
    if (existing && typeof existing.stock === 'number' && existing.qty >= existing.stock) return;
    if (existing && typeof item.stock === 'number' && existing.qty + 1 > item.stock) return;

    const nextQuantity = (existing?.qty || 0) + 1;
    const nextCart = existing
      ? cart.map(i => i.key === key ? { ...i, qty: i.qty + 1, stock: i.stock ?? item.stock, inStock: (i.stock ?? item.stock ?? 0) > 0 } : i)
      : [...cart, { ...item, key, qty: 1, stock: item.stock, inStock: item.inStock ?? (item.stock ?? 0) > 0 }];

    setCart(nextCart);
    persistLocalData(nextCart, wishlist);

    const nextItem = nextCart.find(i => i.key === key);
    if (nextItem) void replaceServerRow(nextItem, nextQuantity);
    if (user) void recordCustomerInteraction(user.id, item.id, 'cart').catch(error => console.error('Unable to record cart interaction:', error));
  };
  const removeFromCart = (key: string) => {
    const item = cart.find(i => i.key === key);
    const nextCart = cart.filter(i => i.key !== key);
    setCart(nextCart);
    persistLocalData(nextCart, wishlist);
    if (item) void deleteServerRow(item);
  };
  const updateQty = (key: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(key);
      return;
    }

    const item = cart.find(i => i.key === key);
    const nextCart = cart.map(i => i.key === key ? { ...i, qty } : i);
    setCart(nextCart);
    persistLocalData(nextCart, wishlist);

    if (item) void replaceServerRow(item, qty);
  };
  const clearCart = () => {
    setCart([]);
    persistLocalData([], wishlist);
    if (user) void supabase.from('cart_items').delete().eq('user_id', user.id);
  };
  const toggleWishlist = (id: string) => {
    const exists = wishlist.includes(id);
    const nextWishlist = exists ? wishlist.filter(w => w !== id) : [...wishlist, id];
    setWishlist(nextWishlist);
    persistLocalData(cart, nextWishlist);

    if (user) {
      if (exists) void supabase.from('wishlist_items').delete().eq('user_id', user.id).eq('product_id', id);
      else {
        void supabase.from('wishlist_items').insert({ user_id: user.id, product_id: id });
        void recordCustomerInteraction(user.id, id, 'wishlist').catch(error => console.error('Unable to record wishlist interaction:', error));
      }
    }
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <Ctx.Provider value={{ cart, addToCart, removeFromCart, updateQty, clearCart, cartCount, cartTotal, wishlist, toggleWishlist }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart outside AppProvider');
  return ctx;
}
