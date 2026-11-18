import type { Product } from '../data/products';

export interface ResolvedVariant {
  label?: string;
  variantId: string;
  price: number;
  originalPrice?: number;
  stock: number;
  // False when the chosen combination does not exist as a sellable variant.
  // The UI must disable Add to Cart in that case instead of silently falling
  // back to the product price with no variant id.
  valid: boolean;
}

// The label the selector currently represents: explicit choice per group, else
// that group's first option. Only meaningful together with variantOptions —
// a pick from a stale selector can name a size that no longer exists.
export function variantSelectionLabel(product: Product, selected?: Record<string, string>): string {
  return (product.variants || [])
    .map(group => selected?.[group.label] || group.options[0])
    .filter(Boolean)
    .join(' / ')
    .trim();
}

// A selection that maps to a real variant, used as the initial/default choice.
// Deriving it from the first variant option (rather than taking the first value
// of every group) avoids selecting a size that no longer exists.
export function defaultVariantSelection(product: Product): Record<string, string> {
  const groups = product.variants || [];
  const first = product.variantOptions?.[0];
  if (first) {
    const parts = first.label.split(' / ');
    if (groups.length === 2 && parts.length === 2) {
      return { [groups[0].label]: parts[0], [groups[1].label]: parts[1] };
    }
    if (groups.length === 1) {
      return { [groups[0].label]: first.label };
    }
  }
  return Object.fromEntries(groups.map(group => [group.label, group.options[0]]));
}

// Whether picking `option` in `groupLabel` still names an existing variant with
// the rest of the current selection held constant.
export function isVariantOptionAvailable(
  product: Product,
  selected: Record<string, string>,
  groupLabel: string,
  option: string,
): boolean {
  if (!product.variantOptions?.length) return true;
  const candidate = { ...selected, [groupLabel]: option };
  const label = variantSelectionLabel(product, candidate);
  return product.variantOptions.some(variant => variant.label === label);
}

// Resolves the variant a shopper is looking at. Exact label match only: when
// the combination does not exist the result is marked invalid, has no variant
// id and no stock, so nothing can be added to the cart.
export function resolveVariant(product: Product, selected?: Record<string, string>): ResolvedVariant {
  if (product.variants?.length) {
    const merged = { ...defaultVariantSelection(product), ...selected };
    const label = variantSelectionLabel(product, merged);
    const option = product.variantOptions?.find(candidate => candidate.label === label);
    if (!option) {
      return {
        label,
        variantId: '',
        price: product.price,
        originalPrice: product.originalPrice,
        stock: 0,
        valid: false,
      };
    }
    return {
      label: option.label,
      variantId: option.id,
      price: option.price,
      originalPrice: option.originalPrice ?? product.originalPrice,
      stock: option.stock,
      valid: true,
    };
  }

  // Products without a selector still carry the first sellable variant id.
  return {
    variantId: product.variantId || '',
    price: product.price,
    originalPrice: product.originalPrice,
    stock: product.stock,
    valid: Boolean(product.variantId),
  };
}
