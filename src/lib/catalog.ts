import { supabase } from './supabase';
import type { Product } from '../data/products';

export interface CatalogCategory {
  id: string;
  name: string;
  description: string;
  image: string;
  count: number;
}

type ProductRow = {
  status: 'Active' | 'Archived' | 'Draft';
  id: string;
  name: string;
  price: number;
  original_price?: number;
  sale_price?: number | null;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_value?: number | null;
  discount_start?: string | null;
  discount_end?: string | null;
  rating: number;
  reviews: number;
  image: string;
  images?: string[];
  description: string;
  tags: string[];
  badge?: string;
  brand?: string;
  category?: string;
  variants?: { label: string; options: string[] }[];
  brands?: { name: string } | null;
  categories?: { name: string; description: string; image: string } | null;
  product_variants?: { id: string; label?: string; options?: string[]; size?: string; scent?: string; inventory?: { stock_quantity: number } | { stock_quantity: number }[] | null }[];
  inventory?: { stock_quantity: number } | { stock_quantity: number }[] | null;
};

function toMany<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

// A product can have several variant rows (e.g. "Standard" and "Value Size"),
// but they all belong under ONE "Size" selector, not one selector each — the
// previous code turned every row into its own {label:'Size', options:[...]}
// entry, so two variants meant two entries with the identical 'Size' label
// (React key collision). Group by kind and collect every distinct option.
function buildVariantGroups(
  variants?: { size?: string; scent?: string }[],
): { label: string; options: string[] }[] | undefined {
  if (!variants?.length) return undefined;
  const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))] as string[];
  const scents = [...new Set(variants.map(v => v.scent).filter(Boolean))] as string[];
  const groups: { label: string; options: string[] }[] = [];
  if (sizes.length) groups.push({ label: 'Size', options: sizes });
  if (scents.length) groups.push({ label: 'Scent', options: scents });
  return groups.length ? groups : undefined;
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id:product_id, name, description, price, original_price, sale_price, discount_type, discount_value, discount_start, discount_end, rating, reviews, image, images, tags, badge, status, created_at, brands(name), categories(name), product_variants(id:variant_id, size, scent, inventory(stock_quantity))')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data || []) as unknown as ProductRow[]).map(row => {
    const normalizedImages = (Array.isArray(row.images) ? row.images : []).filter((url): url is string => typeof url === 'string' && url.trim() !== '');
    const primaryImage = (typeof row.image === 'string' && row.image.trim() !== '') ? row.image : normalizedImages[0] || '';
    const totalStock = Number(row.product_variants?.reduce((sum, variant) =>
      sum + toMany(variant.inventory).reduce((variantTotal, inventory) => variantTotal + Number(inventory.stock_quantity || 0), 0), 0) || 0);

    // The discounted price lives in products.price; original_price is the
    // strikethrough. A sale outside its window (not started / already ended but
    // not yet reverted by expire_discounts) must still read as the full price.
    const now = Date.now();
    const startMs = row.discount_start ? new Date(row.discount_start).getTime() : null;
    const endMs = row.discount_end ? new Date(row.discount_end).getTime() : null;
    const saleActive = Boolean(row.sale_price != null && row.discount_type)
      && (startMs === null || startMs <= now)
      && (endMs === null || endMs > now);
    const basePrice = row.original_price != null ? Number(row.original_price) : Number(row.price);

    const variantLabels = [...new Set((row.product_variants || [])
      .map(v => [v.size, v.scent].filter(Boolean).join(' / ').trim())
      .filter(Boolean))];

    return {
      id: row.id,
      name: row.name,
      price: saleActive ? Number(row.price) : basePrice,
      originalPrice: saleActive && row.original_price != null ? Number(row.original_price) : undefined,
      salePrice: saleActive && row.sale_price != null ? Number(row.sale_price) : null,
      discountType: saleActive ? (row.discount_type || null) : null,
      discountValue: saleActive ? (row.discount_value == null ? null : Number(row.discount_value)) : null,
      discountStart: saleActive ? (row.discount_start || null) : null,
      discountEnd: saleActive ? (row.discount_end || null) : null,
      rating: Number(row.rating),
      reviews: row.reviews,
      image: primaryImage,
      images: normalizedImages.length ? normalizedImages : primaryImage ? [primaryImage] : [],
      description: row.description,
      tags: row.tags,
      badge: row.badge || undefined,
      brand: row.brands?.name || row.brand || '',
      category: row.categories?.name || row.category || '',
      variants: buildVariantGroups(row.product_variants) || row.variants,
      variantId: row.product_variants?.[0]?.id,
      variantName: variantLabels.length
        ? (variantLabels.length === 1 ? variantLabels[0] : `${row.product_variants?.length || variantLabels.length} variants`)
        : undefined,
      stock: totalStock,
      inStock: totalStock > 0 && row.status !== 'Archived',
      status: row.status,
    };
  });
}

// Reverts every product whose sale window has ended (price <- original_price)
// and returns the names that just expired so the admin dashboard can notify.
// Safe to call repeatedly — it is a no-op when nothing has expired.
export async function expireEndedDiscounts(): Promise<string[]> {
  const { data, error } = await supabase.rpc('expire_discounts');
  if (error) return [];
  return (Array.isArray(data) ? data : [])
    .map((row: any) => row?.name)
    .filter((name: any): name is string => typeof name === 'string' && name.trim() !== '');
}

export async function fetchCategories(): Promise<CatalogCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('category_id, name, description, image, products(count)')
    .order('name');
  if (error) throw error;

  const merged = new Map<string, CatalogCategory>();
  (data || []).forEach((row: any) => {
    if (row.name === 'Oral Care') return;
    const isPersonalBody = row.name === 'Personal Care' || row.name === 'Body Care';
    const key = isPersonalBody ? 'personal-body-care' : row.name.toLowerCase().replace(/\s+/g, '-');
    const current = merged.get(key);
    merged.set(key, {
      id: key,
      name: isPersonalBody ? 'Personal & Body Care' : row.name,
      description: isPersonalBody ? 'Daily body, deodorant, shaving, and personal care essentials' : row.description || '',
      image: current?.image || row.image || '',
      count: (current?.count || 0) + (row.products?.[0]?.count || 0),
    });
  });
  return Array.from(merged.values());
}

/** Orders at or above this subtotal ship free (₱). */
export const FREE_SHIPPING_THRESHOLD = 2500;
/** Standard shipping fee below the free-shipping threshold (₱). */
export const SHIPPING_FEE = 150;
/** Philippine VAT rate applied to every order. */
export const VAT_RATE = 0.12;

export async function createOrder(input: {
  customerId: string;
  items: { productId: string; quantity: number; unitPrice: number; variant?: string }[];
  shipping: { name: string; email: string; phone: string; address: string; city: string; zip: string; country: string };
  paymentMethod: 'card' | 'cash_on_delivery';
}) {
  const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingFee = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const tax = subtotal * VAT_RATE;
  const total = subtotal + shippingFee + tax;

  const variantIds = input.items.map(item => item.variant).filter((value): value is string => Boolean(value));
  const { data: variants, error: variantError } = await supabase
    .from('product_variants')
    .select('variant_id, product_id')
    .in('product_id', input.items.map(item => item.productId));
  if (variantError) throw variantError;

  const fallbackVariantByProduct = new Map((variants || []).map(variant => [variant.product_id, variant.variant_id]));
  const requestedVariantIds = input.items.map(item => item.variant ?? fallbackVariantByProduct.get(item.productId)).filter((value): value is string => Boolean(value));

  const { data: inventoryRows, error: inventoryError } = await supabase
    .from('inventory')
    .select('variant_id, stock_quantity')
    .in('variant_id', requestedVariantIds);
  if (inventoryError) throw inventoryError;

  const inventoryMap = new Map((inventoryRows || []).map(row => [row.variant_id, Number(row.stock_quantity || 0)]));

  for (const item of input.items) {
    const variantId = item.variant ?? fallbackVariantByProduct.get(item.productId);
    if (!variantId) throw new Error('One or more products are not configured with a sellable variant.');
    const available = inventoryMap.get(variantId) ?? 0;
    if (available < item.quantity) {
      throw new Error(`Only ${available} unit(s) remain for one of the selected products.`);
    }
  }

  const rpcItems = input.items.map(item => ({
    variant_id: item.variant ?? fallbackVariantByProduct.get(item.productId),
    quantity: item.quantity,
    price_at_purchase: item.unitPrice,
  }));

  const { data: order, error } = await supabase.rpc('place_order', {
    p_user_id: input.customerId,
    p_items: rpcItems,
    p_total_amount: total,
    p_subtotal: subtotal,
    p_shipping_fee: shippingFee,
    p_tax: tax,
    p_payment_method: input.paymentMethod,
    p_shipping_name: input.shipping.name,
    p_shipping_email: input.shipping.email,
    p_shipping_phone: input.shipping.phone,
    p_shipping_address: input.shipping.address,
    p_shipping_city: input.shipping.city,
    p_shipping_zip: input.shipping.zip,
    p_shipping_country: input.shipping.country,
  });
  if (error) throw error;

  const normalized = Array.isArray(order) ? order[0] : order;
  return {
    ...normalized,
    order_number: normalized?.order_no || normalized?.order_number || normalized?.order_id || 'N/A',
  };
}