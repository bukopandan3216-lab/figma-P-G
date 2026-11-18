import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, AlertTriangle, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { safeImage } from '../../lib/image';
import { Button, Badge, DataTable, Modal, Input, ProgressBar, useToast, ToastContainer, LoadingState, useTableMetrics } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { hasModulePermission } from '../../lib/permissions';
import AdminSidebar from '../../components/AdminSidebar';
import { expiryStatus, expiryBadgeVariant, formatExpiryDate } from '../../lib/expiry';

// Each row is one VARIANT, because that's the level inventory is actually
// tracked at in the database (public.inventory.variant_id). A product with
// two variants (e.g. "Standard" and "Value Size") has two independent stock
// counts — collapsing them into a single product-level number, then writing
// that combined total back onto just one variant, is what corrupted stock
// levels every time Stock In/Out was used. Tracking variants directly fixes
// that at the source.
interface VariantStockRow {
  inventoryId: string;
  variantId: string;
  variantLabel: string;
  stock: number;
  reorderLevel: number;
  expiryDate: string | null;
}

interface StockRow {
  productId: string;
  inventoryId: string;
  variantId: string;
  product: string;
  variantLabel: string;
  brand: string;
  category: string;
  stock: number;
  reorderLevel: number;
  image: string;
  variantCount: number;
  variantRows: VariantStockRow[];
  isOutOfStock: boolean;
  isLowStock: boolean;
  expiryDate: string | null;
}
interface InventoryActionTarget {
  inventoryId: string;
  variantId: string;
  productId: string;
  product: string;
  variantLabel: string;
  stock: number;
  reorderLevel: number;
}
interface Movement { id: string; movementNo: string; product: string; variant: string; type: 'Stock In' | 'Stock Out'; qty: number; stockAfter: number | null; userDocument: string | null; date: string; ref: string; }

// `inventory.variant_id` is UNIQUE, so PostgREST treats product_variants →
// inventory as a one-to-one relationship and embeds it as a single object,
// not an array — unlike a normal to-many embed. Normalize both shapes so
// this keeps working regardless of how a given PostgREST version returns it.
function toOne<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

// Dashboard expiry links land here as /admin/inventory?filter=near-expiry|expired.
type StockFilter = 'All' | 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Near Expiry' | 'Expired';
const FILTER_FROM_QUERY: Record<string, StockFilter> = {
  'near-expiry': 'Near Expiry',
  near_expiry: 'Near Expiry',
  expired: 'Expired',
  'in-stock': 'In Stock',
  'low-stock': 'Low Stock',
  'out-of-stock': 'Out of Stock',
};

export default function AdminInventory() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const canManageInventory = hasModulePermission(user, 'inventory', 'manage');
  const canEditInventory = hasModulePermission(user, 'inventory', 'edit');
  const [inventory, setInventory] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'in' | 'out'>('in');
  const [stockTarget, setStockTarget] = useState<InventoryActionTarget | null>(null);
  const [editTarget, setEditTarget] = useState<InventoryActionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [editForm, setEditForm] = useState({ stock: '', reorderLevel: '' });
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedStockFilter, setSelectedStockFilter] = useState<StockFilter>('All');
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ qty: '', ref: '', notes: '' });
  const { toasts, add: addToast, remove } = useToast();
  const MOVEMENT_WINDOW = 6;
  const { headRef: mvHeadRef, bodyRef: mvBodyRef, headH: mvHead, rowH: mvRow } = useTableMetrics(movements.length);
  const mvWindow = mvHead + mvRow * MOVEMENT_WINDOW;

  const loadInventory = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id:product_id, name, image, status, brands(name), categories(name), product_variants(id:variant_id, size, expiry_date, inventory(id:inventory_id, stock_quantity, reorder_level))')
      .neq('status', 'Archived')
      .order('name');
    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

    const rows: StockRow[] = [];
    for (const p of (data || []) as any[]) {
      const variantRows = (p.product_variants || []).filter((v: any) => {
        const inv = toOne<{ id: string; stock_quantity: number; reorder_level: number }>(v.inventory);
        return Boolean(inv);
      });

      const sumStock = variantRows.reduce((sum: number, v: any) => {
        const inv = toOne<{ stock_quantity: number }>(v.inventory);
        return sum + Number(inv?.stock_quantity || 0);
      }, 0);

      const maxReorder = variantRows.reduce((max: number, v: any) => {
        const inv = toOne<{ reorder_level: number }>(v.inventory);
        return Math.max(max, Number(inv?.reorder_level ?? 10));
      }, 0);

      if (!variantRows.length) continue;

      rows.push({
        productId: p.id,
        inventoryId: variantRows[0].inventory?.id || variantRows[0].inventory?.[0]?.id || '',
        variantId: variantRows[0].id,
        product: p.name,
        variantLabel: variantRows.length > 1 ? `${variantRows.length} variants` : variantRows[0].size || 'Standard',
        brand: p.brands?.name || '',
        category: p.categories?.name || '',
        stock: sumStock,
        reorderLevel: maxReorder,
        image: p.image,
        variantCount: variantRows.length,
        expiryDate: variantRows[0].expiry_date ?? null,
        isOutOfStock: variantRows.every((variant: any) => {
          const inv = toOne<{ stock_quantity: number }>(variant.inventory);
          return Number(inv?.stock_quantity || 0) === 0;
        }),
        isLowStock: variantRows.some((variant: any) => {
          const inv = toOne<{ stock_quantity: number; reorder_level: number }>(variant.inventory);
          return Number(inv?.stock_quantity || 0) > 0 && Number(inv?.stock_quantity || 0) < Number(inv?.reorder_level ?? 10);
        }),
        variantRows: variantRows.map((v: any) => {
          const inv = toOne<{ id: string; stock_quantity: number; reorder_level: number }>(v.inventory);
          return {
            inventoryId: inv?.id || '',
            variantId: v.id,
            variantLabel: v.size || 'Standard',
            stock: Number(inv?.stock_quantity || 0),
            reorderLevel: Number(inv?.reorder_level ?? 10),
            expiryDate: v.expiry_date ?? null,
          };
        }),
      });
    }
    setInventory(rows);
    setLoading(false);
  };

  const loadMovements = async () => {
    const { data, error: movementError } = await supabase
      .from('inventory_movements')
      .select('id:movement_id, movement_no, variant_id, movement_type, quantity, stock_after, user_document, reference, created_at, product_variants(size, products(name))')
      .order('created_at', { ascending: false })
      .limit(30);

    if (movementError) { setError(movementError.message); return; }
    setMovements((data || []).map((row: any) => ({
      id: row.id,
      movementNo: row.movement_no || row.id.slice(0, 8),
      product: row.product_variants?.products?.name || row.variant_id,
      variant: row.product_variants?.size || 'Standard',
      type: row.movement_type,
      qty: row.quantity,
      stockAfter: row.stock_after ?? null,
      userDocument: row.user_document ?? null,
      date: new Date(row.created_at).toLocaleDateString(),
      ref: row.reference || '',
    })));
  };

  useEffect(() => { void loadInventory(); void loadMovements(); }, []);

  // Deep link from the Dashboard expiry table: preselect the matching filter.
  useEffect(() => {
    const fromQuery = FILTER_FROM_QUERY[(searchParams.get('filter') || '').toLowerCase()];
    if (fromQuery) setSelectedStockFilter(fromQuery);
  }, [searchParams]);

  const openModal = (type: 'in' | 'out', target: InventoryActionTarget) => {
    setModalType(type);
    setStockTarget(target);
    setForm({ qty: '', ref: '', notes: '' });
    setModalOpen(true);
  };

  const openEdit = (target: InventoryActionTarget) => {
    setEditTarget(target);
    setEditForm({ stock: String(target.stock), reorderLevel: String(target.reorderLevel) });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    const stock = Number(editForm.stock);
    const reorderLevel = Number(editForm.reorderLevel);
    if (!Number.isInteger(stock) || stock < 0) { addToast('error', 'Stock must be a whole number (0 or more).'); return; }
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) { addToast('error', 'Reorder level must be a whole number (0 or more).'); return; }

    const difference = stock - editTarget.stock;
    if (difference !== 0) {
      const { error: movementError } = await supabase.rpc('record_inventory_movement', {
        p_inventory_id: editTarget.inventoryId,
        p_movement_type: difference > 0 ? 'Stock In' : 'Stock Out',
        p_quantity: Math.abs(difference),
        p_reference: null,
        p_notes: 'Inventory adjustment',
      });
      if (movementError) { addToast('error', movementError.message); return; }
    }

    const { error: updateError } = await supabase
      .from('inventory')
      .update({ reorder_level: reorderLevel, updated_at: new Date().toISOString() })
      .eq('inventory_id', editTarget.inventoryId);
    if (updateError) { addToast('error', updateError.message); return; }

    addToast('success', `Inventory updated for ${editTarget.product} (${editTarget.variantLabel}).`);
    setEditTarget(null);
    await Promise.all([loadInventory(), loadMovements()]);
  };

  const archiveProduct = async () => {
    if (!deleteTarget) return;
    const { error: archiveError } = await supabase
      .from('products')
      .update({ status: 'Archived' })
      .eq('product_id', deleteTarget.id);
    if (archiveError) { addToast('error', archiveError.message); return; }

    addToast('info', `${deleteTarget.name} was archived.`);
    setDeleteTarget(null);
    await loadInventory();
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const setEdit = (k: 'stock' | 'reorderLevel') => (e: React.ChangeEvent<HTMLInputElement>) => setEditForm(p => ({ ...p, [k]: e.target.value }));

  const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];

  const submit = async () => {
    if (!stockTarget) return;
    const qty = Number(form.qty);
    if (!Number.isInteger(qty) || qty <= 0) { addToast('error', 'Enter a valid whole-number quantity.'); return; }

    if (modalType === 'out' && qty > stockTarget.stock) {
      addToast('error', `Cannot remove ${qty} units. Only ${stockTarget.stock} in stock.`); return;
    }

    const { error: movementError } = await supabase.rpc('record_inventory_movement', {
      p_inventory_id: stockTarget.inventoryId,
      p_movement_type: modalType === 'in' ? 'Stock In' : 'Stock Out',
      p_quantity: qty,
      p_reference: form.ref || null,
      p_notes: form.notes || null,
    });
    if (movementError) { addToast('error', movementError.message); return; }
    addToast('success', `${modalType === 'in' ? 'Stock added' : 'Stock removed'}: ${qty} units of ${stockTarget.product} (${stockTarget.variantLabel})`);
    setModalOpen(false);
    await Promise.all([loadInventory(), loadMovements()]);
  };

  // The summary cards and the table below are both VARIANT level: the table
  // lists one row per variant, so the counts next to it must be derived from
  // that same list (product-level counts disagreed with the rows shown).
  const filteredInventory = inventory.filter(item => selectedCategory === 'All' || item.category === selectedCategory);
  const categoryVariants = filteredInventory.flatMap(item => item.variantRows.map(variant => ({ item, variant })));
  const outCount = categoryVariants.filter(({ variant }) => variant.stock === 0).length;
  const lowStockCount = categoryVariants.filter(({ variant }) => variant.stock > 0 && variant.stock < variant.reorderLevel).length;
  const inStockCount = categoryVariants.length - outCount - lowStockCount;
  const totalUnits = categoryVariants.reduce((sum, { variant }) => sum + variant.stock, 0);
  const totalVariants = categoryVariants.length;
  const totalProducts = filteredInventory.length;
  const nearExpiryCount = categoryVariants.filter(({ variant }) => expiryStatus(variant.expiryDate) === 'Near Expiry').length;
  const expiredCount = categoryVariants.filter(({ variant }) => expiryStatus(variant.expiryDate) === 'Expired').length;
  const displayInventory = categoryVariants
    .filter(({ variant }) => {
      const isOutOfStock = variant.stock === 0;
      const isLowStock = variant.stock > 0 && variant.stock < variant.reorderLevel;
      const status = expiryStatus(variant.expiryDate);
      return (
        selectedStockFilter === 'All' ||
        (selectedStockFilter === 'Low Stock' && isLowStock) ||
        (selectedStockFilter === 'Out of Stock' && isOutOfStock) ||
        (selectedStockFilter === 'In Stock' && !isOutOfStock && !isLowStock) ||
        (selectedStockFilter === 'Near Expiry' && status === 'Near Expiry') ||
        (selectedStockFilter === 'Expired' && status === 'Expired')
      );
    })
    .map(({ item, variant }) => ({
      ...item,
      inventoryId: variant.inventoryId,
      variantId: variant.variantId,
      variantLabel: variant.variantLabel,
      stock: variant.stock,
      reorderLevel: variant.reorderLevel,
      expiryDate: variant.expiryDate,
      variantCount: 1,
      isOutOfStock: variant.stock === 0,
      isLowStock: variant.stock > 0 && variant.stock < variant.reorderLevel,
    }));

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Inventory</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Track and manage stock levels per product variant.</p>
          </div>
        </div>

        {(lowStockCount > 0 || outCount > 0 || nearExpiryCount > 0 || expiredCount > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-lg)] p-4 flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              {lowStockCount > 0 && <><strong>{lowStockCount} item{lowStockCount > 1 ? 's' : ''}</strong> running low. </>}
              {outCount > 0 && <><strong>{outCount} item{outCount > 1 ? 's' : ''}</strong> out of stock. </>}
              {nearExpiryCount > 0 && <><strong>{nearExpiryCount} variant{nearExpiryCount > 1 ? 's' : ''}</strong> near expiry (hidden from customers). </>}
              {expiredCount > 0 && <><strong>{expiredCount} variant{expiredCount > 1 ? 's' : ''}</strong> expired (hidden from customers).</>}
            </p>
          </div>
        )}

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Inventory Summary</p>
              <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">{totalProducts} products · {totalVariants} variants</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Total Stock', count: totalUnits, color: 'text-sky-600', subtle: 'bg-sky-50', filter: 'All' },
                { label: 'In Stock', count: inStockCount, color: 'text-emerald-600', subtle: 'bg-emerald-50', filter: 'In Stock' },
                { label: 'Low Stock', count: lowStockCount, color: 'text-amber-600', subtle: 'bg-amber-50', filter: 'Low Stock' },
                { label: 'Out of Stock', count: outCount, color: 'text-red-600', subtle: 'bg-red-50', filter: 'Out of Stock' },
                { label: 'Near Expiry', count: nearExpiryCount, color: 'text-orange-600', subtle: 'bg-orange-50', filter: 'Near Expiry' },
                { label: 'Expired', count: expiredCount, color: 'text-red-700', subtle: 'bg-red-50', filter: 'Expired' },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setSelectedStockFilter(s.filter as StockFilter)}
                  className={`${s.subtle} rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition hover:brightness-[0.98] ${selectedStockFilter === s.filter ? 'ring-2 ring-[var(--primary)] ring-offset-0' : ''}`}
                >
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted-foreground)] mt-1">{s.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="overflow-x-auto">
              <div className="flex min-w-max gap-2">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                      selectedCategory === category
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 self-end lg:self-auto">
              <label htmlFor="stock-filter" className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Stock filter</label>
              <select
                id="stock-filter"
                value={selectedStockFilter}
                onChange={(event) => setSelectedStockFilter(event.target.value as StockFilter)}
                className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] outline-none focus:border-[var(--primary)]"
              >
                <option value="All">All</option>
                <option value="In Stock">In Stock</option>
                <option value="Low Stock">Low Stock</option>
                <option value="Out of Stock">Out of Stock</option>
                <option value="Near Expiry">Near Expiry</option>
                <option value="Expired">Expired</option>
              </select>
            </div>
          </div>

          <DataTable
            data={displayInventory.map(i => ({
              ...i,
              _status: i.isOutOfStock
                ? { label: 'Out of Stock', variant: 'danger' as const }
                : i.isLowStock
                  ? { label: 'Low Stock', variant: 'warning' as const }
                  : { label: 'In Stock', variant: 'success' as const },
              _expiry: {
                label: expiryStatus(i.expiryDate),
                variant: expiryBadgeVariant(expiryStatus(i.expiryDate)),
                date: formatExpiryDate(i.expiryDate),
              },
            })) as any}
            emptyMessage={loading ? <LoadingState message="Hang tight, loading inventory…" /> : 'No inventory items found.'}
            columns={[
              { key: 'product', label: 'Product', render: (row: any) => (
                <div className="flex items-center gap-3">
                  <img src={safeImage(row.image, row.product)} alt="" className="w-8 h-8 object-cover rounded bg-[var(--secondary)]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--foreground)] truncate">{row.product}</div>
                    <div className="text-xs text-[var(--muted-foreground)] truncate">{row.brand} · {row.variantLabel}</div>
                  </div>
                </div>
              )},
              { key: 'category', label: 'Category' },
              { key: 'variantLabel', label: 'Variant', render: (row: any) => <span className="text-sm text-[var(--muted-foreground)]">{row.variantLabel}</span> },
              { key: 'stock', label: 'Current Stock', render: (row: any) => (
                <div className="flex flex-col gap-1 min-w-24">
                  <span className="font-mono text-sm font-medium">{row.stock} units</span>
                  <ProgressBar value={row.stock} max={Math.max(100, row.stock || 10)} />
                </div>
              )},
              { key: 'reorderLevel', label: 'Reorder At', render: (row: any) => <span className="font-mono text-sm text-[var(--muted-foreground)]">{row.reorderLevel} units</span> },
              { key: 'expiryDate', label: 'Expiry', render: (row: any) => (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-[var(--muted-foreground)]">{row._expiry.date}</span>
                  <Badge variant={row._expiry.variant}>{row._expiry.label}</Badge>
                </div>
              )},
              { key: '_status', label: 'Stock Status', render: (row: any) => <Badge variant={row._status.variant}>{row._status.label}</Badge> },
              { key: 'actions', label: 'Actions', sortable: false, render: (row: any) => {
                const target = row as InventoryActionTarget;
                return (
                  <div className="flex items-center gap-1.5">
                    {canManageInventory && <>
                      <button type="button" onClick={() => openModal('in', target)} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-emerald-50" title="Stock In" aria-label={`Stock in for ${target.product} (${target.variantLabel})`}><ArrowDown size={13} /> In</button>
                      <button type="button" onClick={() => openModal('out', target)} className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-red-50" title="Stock Out" aria-label={`Stock out for ${target.product} (${target.variantLabel})`}><ArrowUp size={13} /> Out</button>
                    </>}
                    {canEditInventory && <button type="button" onClick={() => openEdit(target)} className="p-1.5 hover:bg-[var(--secondary)] rounded transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="Edit inventory" aria-label={`Edit ${target.product} (${target.variantLabel})`}><Edit2 size={14} /></button>}
                    {isSuperAdmin && <button type="button" onClick={() => setDeleteTarget({ id: target.productId, name: target.product })} className="p-1.5 hover:bg-red-50 rounded transition-colors text-[var(--muted-foreground)] hover:text-red-500" title="Archive product" aria-label={`Archive ${target.product}`}><Trash2 size={14} /></button>}
                  </div>
                );
              }},
            ]}
          />
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <h2 className="font-semibold text-sm mb-4">Movement History</h2>
          <div className="overflow-x-auto overflow-y-auto" style={{ minHeight: mvWindow, maxHeight: mvWindow }}>
            <table className="w-full text-sm">
              <thead ref={mvHeadRef}>
                <tr className="border-b border-[var(--border)]">
                  {['Movement No', 'Product', 'Type', 'Quantity', 'Stock After', 'Document', 'Date', 'Reference'].map(h => (
                    <th key={h} className="sticky top-0 z-10 bg-white border-b border-[var(--border)] text-left px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody ref={mvBodyRef} className="whitespace-nowrap">
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--secondary)] transition-colors">
                    <td className="px-3 py-3 font-mono text-xs text-[var(--muted-foreground)]">{m.movementNo}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium max-w-[240px] truncate">{m.product}</div>
                      <div className="text-xs text-[var(--muted-foreground)] max-w-[240px] truncate">{m.variant}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${m.type === 'Stock In' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {m.type === 'Stock In' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}{m.type}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono">{m.type === 'Stock Out' ? '-' : '+'}{m.qty}</td>
                    <td className="px-3 py-3 font-mono">{m.stockAfter == null ? '—' : `${m.stockAfter} units`}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)] text-xs">{m.userDocument || '—'}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)] text-xs">{m.date}</td>
                    <td className="px-3 py-3 text-xs text-[var(--primary)] font-mono">{m.ref}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr><td colSpan={8} style={{ height: mvRow * MOVEMENT_WINDOW }} className="px-3 text-center text-xs text-[var(--muted-foreground)]">No stock movements recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={modalType === 'in' ? 'Record Stock In' : 'Record Stock Out'}>
          <div className="flex flex-col gap-4">
            {stockTarget && <p className="rounded-[var(--radius)] bg-[var(--secondary)] px-3 py-2 text-sm"><strong>{stockTarget.product}</strong> · {stockTarget.variantLabel} · {stockTarget.stock} in stock</p>}
            <Input label="Quantity *" type="number" min="1" step="1" value={form.qty} onChange={set('qty')} placeholder="Enter quantity" />
            <Input label={modalType === 'in' ? 'Purchase Order Ref.' : 'Sales Order Ref.'} value={form.ref} onChange={set('ref')} placeholder={modalType === 'in' ? 'PO-2026-XXXXXX' : 'ORD-2026-XXXXXX'} />
            <Input label="Notes (optional)" value={form.notes} onChange={set('notes')} placeholder="Any additional notes…" />
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
              <Button className="flex-1" onClick={submit}>Record {modalType === 'in' ? 'Stock In' : 'Stock Out'}</Button>
            </div>
          </div>
        </Modal>

        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Inventory">
          <div className="flex flex-col gap-4">
            {editTarget && <p className="text-sm text-[var(--muted-foreground)]">{editTarget.product} · {editTarget.variantLabel}</p>}
            <Input label="Current Stock *" type="number" min="0" step="1" value={editForm.stock} onChange={setEdit('stock')} />
            <Input label="Reorder At *" type="number" min="0" step="1" value={editForm.reorderLevel} onChange={setEdit('reorderLevel')} />
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setEditTarget(null)} className="flex-1">Cancel</Button>
              <Button onClick={saveEdit} className="flex-1">Save Changes</Button>
            </div>
          </div>
        </Modal>

        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Archive Product" size="sm">
          <p className="text-sm text-[var(--muted-foreground)] mb-6">
            {deleteTarget?.name} will be archived and removed from the inventory list. Existing order history is preserved.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={archiveProduct} className="flex-1">Archive Product</Button>
          </div>
        </Modal>
      </div>
    </AdminSidebar>
  );
}
