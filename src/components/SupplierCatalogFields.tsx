import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button, Input, Select } from './ui';

export type SupplierVariantDraft = {
  size: string;
  price: string;
  stock: string;
  expiryDate: string;
};

export type SupplierProductDraft = {
  name: string;
  categoryId: string;
  description: string;
  tags: string[];
  variants: SupplierVariantDraft[];
};

export type SupplierCategoryOption = {
  id: string;
  name: string;
};

export const emptySupplierVariant = (): SupplierVariantDraft => ({
  size: '',
  price: '',
  stock: '0',
  expiryDate: '',
});

export const emptySupplierProduct = (): SupplierProductDraft => ({
  name: '',
  categoryId: '',
  description: '',
  tags: [],
  variants: [emptySupplierVariant()],
});

const normalizeTags = (values: string[]) => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
};

function SupplierProductTags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const addValues = (value: string) => {
    const values = value.split(',');
    if (!values.some(item => item.trim())) return;
    onChange(normalizeTags([...tags, ...values]));
    setDraft('');
  };

  const commitDraft = () => {
    if (draft.trim()) addValues(draft);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-[var(--foreground)]">Tags</label>
      <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-inner)] border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--ring)]">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--foreground)]">
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter(existing => existing !== tag))}
              title={`Remove ${tag}`}
              aria-label={`Remove ${tag} tag`}
              className="text-[var(--muted-foreground)] transition-colors hover:text-red-500"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={event => {
            const value = event.target.value;
            if (value.includes(',')) addValues(value);
            else setDraft(value);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              addValues(draft);
            } else if (event.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={commitDraft}
          placeholder={tags.length ? 'Add another tag…' : 'e.g. moisturizer, anti-aging'}
          aria-label="Product tags"
          className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
        />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">Press Enter or comma to add a tag. Tags power product search and recommendations.</p>
    </div>
  );
}

export function validateSupplierCatalog(brandName: string, products: SupplierProductDraft[]) {
  if (!brandName.trim()) return 'Brand name is required and must be unique to this supplier.';
  const productNames = new Set<string>();
  for (const [productIndex, product] of products.entries()) {
    const label = product.name.trim() || `Product ${productIndex + 1}`;
    if (!product.name.trim()) return `Product ${productIndex + 1}: name is required.`;
    const normalized = product.name.trim().toLowerCase();
    if (productNames.has(normalized)) return `Product "${label}" is listed twice.`;
    productNames.add(normalized);
    if (!product.categoryId) return `Product "${label}": choose a category.`;
    if (!product.variants.length) return `Product "${label}": add at least one variant.`;
    const sizes = new Set<string>();
    for (const [variantIndex, variant] of product.variants.entries()) {
      const variantLabel = `Product "${label}", variant ${variantIndex + 1}`;
      const size = variant.size.trim().toLowerCase();
      if (!size) return `${variantLabel}: enter a size.`;
      if (variant.price.trim() === '' || Number(variant.price) < 0) return `${variantLabel}: enter a valid price.`;
      if (variant.stock.trim() === '' || Number(variant.stock) < 0) return `${variantLabel}: enter a valid stock.`;
      if (!variant.expiryDate) return `${variantLabel}: enter an expiry date.`;
      if (sizes.has(size)) return `${variantLabel}: duplicate size "${variant.size.trim()}".`;
      sizes.add(size);
    }
  }
  return '';
}

export default function SupplierCatalogFields({
  brandName,
  onBrandNameChange,
  products,
  setProducts,
  categories,
}: {
  brandName: string;
  onBrandNameChange: (value: string) => void;
  products: SupplierProductDraft[];
  setProducts: React.Dispatch<React.SetStateAction<SupplierProductDraft[]>>;
  categories: SupplierCategoryOption[];
}) {
  const updateProduct = (index: number, patch: Partial<SupplierProductDraft>) => {
    setProducts(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const updateVariant = (productIndex: number, variantIndex: number, patch: Partial<SupplierVariantDraft>) => {
    setProducts(rows => rows.map((row, rowIndex) => rowIndex !== productIndex ? row : {
      ...row,
      variants: row.variants.map((variant, index) => index === variantIndex ? { ...variant, ...patch } : variant),
    }));
  };

  const addVariant = (productIndex: number) => {
    setProducts(rows => rows.map((row, rowIndex) => rowIndex !== productIndex ? row : {
      ...row,
      variants: [...row.variants, emptySupplierVariant()],
    }));
  };

  const removeVariant = (productIndex: number, variantIndex: number) => {
    setProducts(rows => rows.map((row, rowIndex) => rowIndex !== productIndex ? row : {
      ...row,
      variants: row.variants.length > 1 ? row.variants.filter((_, index) => index !== variantIndex) : row.variants,
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--secondary)]/40 p-4">
        <Input
          label="Brand Name *"
          value={brandName}
          onChange={event => onBrandNameChange(event.target.value)}
          placeholder="Unique brand owned by this supplier"
        />
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Each supplier owns its own brand. The brand name must not exist yet.</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Products &amp; Variants</p>
          <p className="text-xs text-[var(--muted-foreground)]">This brand's products must be new to the catalogue. Every product needs at least one size variant.</p>
        </div>
        <Button variant="outline" onClick={() => setProducts(rows => [...rows, emptySupplierProduct()])}>
          <Plus size={14} /> Product
        </Button>
      </div>

      {products.map((product, productIndex) => (
        <div key={productIndex} className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Product {productIndex + 1}</p>
            {products.length > 1 && (
              <button
                type="button"
                title="Remove product"
                aria-label={`Remove product ${productIndex + 1}`}
                onClick={() => setProducts(rows => rows.filter((_, index) => index !== productIndex))}
                className="rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Product Name *"
              value={product.name}
              onChange={event => updateProduct(productIndex, { name: event.target.value })}
              placeholder="e.g. Hydrating Body Wash"
            />
            <Select
              label="Category *"
              value={product.categoryId}
              onChange={event => updateProduct(productIndex, { categoryId: event.target.value })}
              options={[{ value: '', label: 'Select category' }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
            />
          </div>
          <Input
            label="Description"
            value={product.description}
            onChange={event => updateProduct(productIndex, { description: event.target.value })}
            placeholder="Optional short description"
          />
          <SupplierProductTags
            tags={product.tags}
            onChange={tags => updateProduct(productIndex, { tags })}
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Variants (sizes must be unique within the product)</p>
              <Button type="button" variant="outline" onClick={() => addVariant(productIndex)}>
                <Plus size={13} /> Variant
              </Button>
            </div>
            {product.variants.map((variant, variantIndex) => (
              <div key={variantIndex} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.2fr_0.8fr_0.7fr_1fr_auto]">
                <Input
                  label="Size *"
                  value={variant.size}
                  onChange={event => updateVariant(productIndex, variantIndex, { size: event.target.value })}
                  placeholder="250ml"
                />
                <Input
                  label="Price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={variant.price}
                  onChange={event => updateVariant(productIndex, variantIndex, { price: event.target.value })}
                  placeholder="0.00"
                />
                <Input
                  label="Stock"
                  type="number"
                  min="0"
                  step="1"
                  value={variant.stock}
                  onChange={event => updateVariant(productIndex, variantIndex, { stock: event.target.value })}
                />
                <Input
                  label="Expiry *"
                  type="date"
                  value={variant.expiryDate}
                  onChange={event => updateVariant(productIndex, variantIndex, { expiryDate: event.target.value })}
                />
                <button
                  type="button"
                  title="Remove variant"
                  aria-label={`Remove variant ${variantIndex + 1}`}
                  disabled={product.variants.length === 1}
                  onClick={() => removeVariant(productIndex, variantIndex)}
                  className="mb-2 rounded p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <p className="text-[11px] text-[var(--muted-foreground)]">Enter a size for each variant, plus price, stock, and expiry date.</p>
          </div>
        </div>
      ))}
    </div>
  );
}
