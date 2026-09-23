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
  id: string;
  name: string;
  price: number;
  original_price?: number;
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
  product_variants?: { id: string; label?: string; options?: string[]; size?: string; scent?: string; inventory?: { stock_quantity: number }[] }[];
  inventory?: { stock_quantity: number } | null;
};

// `inventory.variant_id` is UNIQUE, so PostgREST embeds product_variants →
// inventory as a single object (one-to-one), not an array. Normalize both
// shapes so stock totals don't silently come back as 0.
function toOne<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
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
    .select('*, brands(name), categories(name), product_variants(id, size, scent, inventory(stock_quantity))')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data || []) as ProductRow[]).map(row => {
    const normalizedImages = (Array.isArray(row.images) ? row.images : []).filter((url): url is string => typeof url === 'string' && url.trim() !== '');
    const primaryImage = (typeof row.image === 'string' && row.image.trim() !== '') ? row.image : normalizedImages[0] || '';
    const totalStock = Number(row.product_variants?.reduce((sum, variant) => sum + Number(toOne(variant.inventory)?.stock_quantity || 0), 0) || 0);

    return {
      id: row.id,
      name: row.name,
      price: Number(row.price),
      originalPrice: row.original_price == null ? undefined : Number(row.original_price),
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
      stock: totalStock,
      inStock: totalStock > 0 && row.status !== 'Archived',
    };
  });
}

export async function fetchCategories(): Promise<CatalogCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, description, image, products(count)')
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

export async function createOrder(input: {
  customerId: string;
  items: { productId: string; quantity: number; unitPrice: number; variant?: string }[];
  shipping: { name: string; email: string; phone: string; address: string; city: string; zip: string; country: string };
  paymentMethod: 'card' | 'cash_on_delivery';
}) {
  const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingFee = subtotal >= 35 ? 0 : 4.99;
  const tax = subtotal * 0.12;
  const total = subtotal + shippingFee + tax;

  const variantIds = input.items.map(item => item.variant).filter((value): value is string => Boolean(value));
  const { data: variants, error: variantError } = await supabase
    .from('product_variants')
    .select('id, product_id')
    .in('product_id', input.items.map(item => item.productId));
  if (variantError) throw variantError;

  const fallbackVariantByProduct = new Map((variants || []).map(variant => [variant.product_id, variant.id]));
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
    order_number: normalized?.order_no || normalized?.order_number || normalized?.id || 'N/A',
  };
}