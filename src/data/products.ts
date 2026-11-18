export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  originalPrice?: number;
  salePrice?: number | null;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountStart?: string | null;
  discountEnd?: string | null;
  rating: number;
  reviews: number;
  image: string;
  images?: string[];
  description: string;
  tags: string[];
  inStock: boolean;
  stock: number;
  status?: 'Active' | 'Archived' | 'Draft';
  variants?: { label: string; options: string[] }[];
  // Variant photos keyed by the variant label shown in the selector. The gallery
  // prefers these over the product's own images while that option is selected.
  variantImages?: Record<string, string[]>;
  // Sale-aware unit price per variant label (product base + additional_price),
  // plus the undiscounted listing for the strikethrough.
  variantPrices?: Record<string, number>;
  variantOriginalPrices?: Record<string, number>;
  // Storefront-safe variant details: expiry-flagged variants are already gone.
  variantOptions?: {
    id: string;
    label: string;
    price: number;
    originalPrice?: number;
    stock: number;
    expiryDate: string | null;
    expiryStatus: 'No Expiry' | 'Fresh' | 'Near Expiry' | 'Expired';
  }[];
  variantId?: string;
  variantName?: string;
  supplier?: string;
  badge?: string;
}
