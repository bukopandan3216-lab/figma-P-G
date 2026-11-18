// ─── Variant expiry rules (one definition for admin + storefront) ────────────
// Mirrors the check inside public.place_order: a variant is sellable only when
// its expiry date is more than NEAR_EXPIRY_DAYS away (or unset). "Expired" and
// "Near Expiry" variants are hidden from customers; the product stays listed
// while any of its variants is still sellable.
export const NEAR_EXPIRY_DAYS = 60;

export type ExpiryStatus = 'No Expiry' | 'Fresh' | 'Near Expiry' | 'Expired';

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/** Whole days from today until the expiry date (negative once expired). */
export function daysUntilExpiry(expiryDate: string | null | undefined): number | null {
  if (!expiryDate) return null;
  const [year, month, day] = expiryDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const target = new Date(year, month - 1, day).getTime();
  return Math.round((target - startOfToday()) / 86_400_000);
}

export function expiryStatus(expiryDate: string | null | undefined): ExpiryStatus {
  const days = daysUntilExpiry(expiryDate);
  if (days === null) return 'No Expiry';
  if (days <= 0) return 'Expired';
  if (days <= NEAR_EXPIRY_DAYS) return 'Near Expiry';
  return 'Fresh';
}

/** True when the variant may be shown to (and sold to) customers. */
export function isSellableVariant(expiryDate: string | null | undefined): boolean {
  const status = expiryStatus(expiryDate);
  return status === 'No Expiry' || status === 'Fresh';
}

export function expiryBadgeVariant(status: ExpiryStatus): 'danger' | 'warning' | 'success' | 'muted' {
  if (status === 'Expired') return 'danger';
  if (status === 'Near Expiry') return 'warning';
  if (status === 'Fresh') return 'success';
  return 'muted';
}

export function formatExpiryDate(expiryDate: string | null | undefined): string {
  if (!expiryDate) return '—';
  const [year, month, day] = expiryDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Date(year, month - 1, day).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
