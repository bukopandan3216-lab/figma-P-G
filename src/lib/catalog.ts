import { supabase } from './supabase';
import type { Product } from '../data/products';
import { isSellableVariant, expiryStatus } from './expiry';

// ─── Supplier pricing (the ONE place the markup lives) ───────────────────────
// SUPPLIER_MARKUP_PERCENT is the only definition of the markup anywhere in the
// app. Shop prices are never derived from it — customers always pay the price
// stored on the product — so changing this number changes NOTHING a customer
// sees. It only decides the hidden supplier cost written on variants saved
// after the change:
//
//     hidden cost = full app listing price / (1 + SUPPLIER_MARKUP_PERCENT / 100)
//
// To recompute costs for variants that already exist, run the backfill SQL
// documented in supabase/schema_complete.sql (search: "backfill supplier_price").
// The cost is never typed or displayed in the UI (purchase orders show only
// the grand total); the database uses it as purchase_order_items.unit_cost.
export const SUPPLIER_MARKUP_PERCENT = 30;

/** Hidden supplier cost for a variant, derived from the price the app lists it at. */
export function supplierCostFromListing(listingPrice: number): number {
  return Math.round((Number(listingPrice) / (1 + SUPPLIER_MARKUP_PERCENT / 100)) * 100) / 100;
}


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
  product_variants?: { id: string; label?: string; options?: string[]; size?: string; additional_price?: number; expiry_date?: string | null; images?: string[] | null; inventory?: { stock_quantity: number } | { stock_quantity: number }[] | null }[];
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
  variants?: { size?: string }[],
): { label: string; options: string[] }[] | undefined {
  if (!variants?.length) return undefined;
  const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))] as string[];
  const groups: { label: string; options: string[] }[] = [];
  if (sizes.length) groups.push({ label: 'Size', options: sizes });
  return groups.length ? groups : undefined;
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id:product_id, name, description, price, original_price, sale_price, discount_type, discount_value, discount_start, discount_end, rating, reviews, image, images, tags, badge, status, created_at, brands(name), categories(name), product_variants(id:variant_id, size, additional_price, expiry_date, images, inventory(stock_quantity))')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const products: Product[] = [];
  for (const row of (data || []) as unknown as ProductRow[]) {
    const normalizedImages = (Array.isArray(row.images) ? row.images : []).filter((url): url is string => typeof url === 'string' && url.trim() !== '');
    const primaryImage = (typeof row.image === 'string' && row.image.trim() !== '') ? row.image : normalizedImages[0] || '';

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

    const allVariants = row.product_variants || [];
    // Expired and Near Expiry variants are never shown or sold. The product
    // survives while one variant is still sellable; it disappears only when
    // every single variant is flagged.
    const sellableVariants = allVariants.filter(variant => isSellableVariant(variant.expiry_date));
    if (allVariants.length > 0 && sellableVariants.length === 0) continue;

    const visibleVariants = allVariants.length ? sellableVariants : allVariants;
    const labelOf = (variant: NonNullable<ProductRow['product_variants']>[number]) =>
      variant.size?.trim() || '';
    const stockOf = (variants: NonNullable<ProductRow['product_variants']>) => variants.reduce((sum, variant) =>
      sum + toMany(variant.inventory).reduce((variantTotal, inventory) => variantTotal + Number(inventory.stock_quantity || 0), 0), 0);

    const totalStock = Number(stockOf(visibleVariants));

    const variantLabels = [...new Set(visibleVariants.map(labelOf).filter(Boolean))];

    // Per-variant pricing keyed by the exact label the selector shows. Prices
    // are the sale-aware unit price; originalPrices stay at the full listing.
    const variantPrices: Record<string, number> = {};
    const variantOriginalPrices: Record<string, number> = {};
    const variantOptions: NonNullable<Product['variantOptions']> = [];
    for (const variant of visibleVariants) {
      const label = labelOf(variant);
      if (!label) continue;
      const additional = Number(variant.additional_price || 0);
      const listing = basePrice + additional;
      const effective = saleActive ? Number(row.price) + additional : listing;
      variantPrices[label] = effective;
      variantOriginalPrices[label] = listing;
      variantOptions.push({
        id: variant.id,
        label,
        price: effective,
        originalPrice: saleActive ? listing : undefined,
        stock: stockOf([variant]),
        expiryDate: variant.expiry_date ?? null,
        expiryStatus: expiryStatus(variant.expiry_date),
      });
    }

    const pricedVariants = visibleVariants.filter(variant => labelOf(variant));
    const displayPrice = pricedVariants.length
      ? Math.min(...pricedVariants.map(variant => variantPrices[labelOf(variant)]))
      : (saleActive ? Number(row.price) : basePrice);
    const displayOriginal = saleActive && pricedVariants.length
      ? Math.min(...pricedVariants.map(variant => basePrice + Number(variant.additional_price || 0)))
      : undefined;

    // Variant photos keyed by the exact label the variant selector shows, so
    // the product gallery can follow whichever option is selected.
    const variantImages: Record<string, string[]> = {};
    for (const variant of visibleVariants) {
      const label = labelOf(variant);
      const urls = (Array.isArray(variant.images) ? variant.images : [])
        .filter((url): url is string => typeof url === 'string' && url.trim() !== '');
      if (label && urls.length) variantImages[label] = urls;
    }

    products.push({
      id: row.id,
      name: row.name,
      price: displayPrice,
      originalPrice: displayOriginal,
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
      variants: buildVariantGroups(visibleVariants) || row.variants,
      variantImages: Object.keys(variantImages).length ? variantImages : undefined,
      variantPrices: Object.keys(variantPrices).length ? variantPrices : undefined,
      variantOriginalPrices: Object.keys(variantOriginalPrices).length ? variantOriginalPrices : undefined,
      variantOptions: variantOptions.length ? variantOptions : undefined,
      variantId: visibleVariants[0]?.id,
      variantName: variantLabels.length
        ? (variantLabels.length === 1 ? variantLabels[0] : `${visibleVariants.length || variantLabels.length} variants`)
        : undefined,
      stock: totalStock,
      inStock: totalStock > 0 && row.status !== 'Archived',
      status: row.status,
    });
  }
  return products;
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

  // Every line must name its exact variant; never guess one from the product,
  // otherwise a cart holding two variants of one product could check out with
  // the wrong SKU and the wrong price.
  const variantIds = input.items.map(item => item.variant);
  if (variantIds.some((variantId): variantId is undefined => !variantId)) {
    throw new Error('One or more cart items are missing their variant. Remove it and add the product again.');
  }

  const { data: variants, error: variantError } = await supabase
    .from('product_variants')
    .select('variant_id, product_id')
    .in('variant_id', variantIds as string[]);
  if (variantError) throw variantError;

  const productByVariant = new Map((variants || []).map(variant => [variant.variant_id, variant.product_id]));

  const { data: inventoryRows, error: inventoryError } = await supabase
    .from('inventory')
    .select('variant_id, stock_quantity')
    .in('variant_id', variantIds as string[]);
  if (inventoryError) throw inventoryError;

  const inventoryMap = new Map((inventoryRows || []).map(row => [row.variant_id, Number(row.stock_quantity || 0)]));

  for (const item of input.items) {
    if (productByVariant.get(item.variant!) !== item.productId) {
      throw new Error('One or more cart items no longer match their product variant.');
    }
    const available = inventoryMap.get(item.variant!) ?? 0;
    if (available < item.quantity) {
      throw new Error(`Only ${available} unit(s) remain for one of the selected products.`);
    }
  }

  const rpcItems = input.items.map(item => ({
    variant_id: item.variant,
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