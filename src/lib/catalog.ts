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
    .eq('status', 'Active')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data || []) as ProductRow[]).map(row => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    originalPrice: row.original_price == null ? undefined : Number(row.original_price),
    rating: Number(row.rating),
    reviews: row.reviews,
    image: row.image,
    images: row.images,
    description: row.description,
    tags: row.tags,
    badge: row.badge || undefined,
    brand: row.brands?.name || row.brand || '',
    category: row.categories?.name || row.category || '',
    variants: buildVariantGroups(row.product_variants) || row.variants,
    variantId: row.product_variants?.[0]?.id,
    stock: Number(row.product_variants?.reduce((sum, variant) => sum + Number(toOne(variant.inventory)?.stock_quantity || 0), 0) || 0),
    inStock: Number(row.product_variants?.reduce((sum, variant) => sum + Number(toOne(variant.inventory)?.stock_quantity || 0), 0) || 0) > 0,
  }));
}

export async function fetchCategories(): Promise<CatalogCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, description, image, products(count)')
    .order('name');
  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: row.name.toLowerCase().replace(/\s+/g, '-'),
    name: row.name,
    description: row.description || '',
    image: row.image || '',
    count: row.products?.[0]?.count || 0,
  }));
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

  const { data: variants, error: variantError } = await supabase
    .from('product_variants')
    .select('id, product_id')
    .in('product_id', input.items.map(item => item.productId));
  if (variantError) throw variantError;
  const variantByProduct = new Map((variants || []).map(variant => [variant.product_id, variant.id]));
  const rpcItems = input.items.map(item => ({
    variant_id: variantByProduct.get(item.productId),
    quantity: item.quantity,
    price_at_purchase: item.unitPrice,
  }));
  if (rpcItems.some(item => !item.variant_id)) throw new Error('One or more products are not configured with a sellable variant.');

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
  return order;
}