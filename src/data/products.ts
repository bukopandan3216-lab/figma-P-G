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
  variantId?: string;
  variantName?: string;
  supplier?: string;
  badge?: string;
}
