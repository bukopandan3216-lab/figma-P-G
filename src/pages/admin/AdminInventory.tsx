import { useEffect, useState } from 'react';
import { Plus, ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { safeImage } from '../../lib/image';
import { Button, Badge, DataTable, Modal, Input, Select, ProgressBar, useToast, ToastContainer } from '../../components/ui';
import AdminSidebar from '../../components/AdminSidebar';

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
}
interface Movement { id: string; movementNo: string; product: string; type: 'Stock In' | 'Stock Out'; qty: number; currentStock: number | null; date: string; ref: string; }

// `inventory.variant_id` is UNIQUE, so PostgREST treats product_variants →
// inventory as a one-to-one relationship and embeds it as a single object,
// not an array — unlike a normal to-many embed. Normalize both shapes so
// this keeps working regardless of how a given PostgREST version returns it.
function toOne<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

const getStatus = (stock: number, reorderLevel: number) => {
  if (stock === 0) return { label: 'Out of Stock', variant: 'danger' as const };
  if (stock < reorderLevel) return { label: 'Low Stock', variant: 'warning' as const };
  return { label: 'In Stock', variant: 'success' as const };
};

export default function AdminInventory() {
  const [inventory, setInventory] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'in' | 'out'>('in');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [form, setForm] = useState({ inventoryId: '', qty: '', ref: '', notes: '' });
  const { toasts, add: addToast, remove } = useToast();

  const loadInventory = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id, name, image, status, brands(name), categories(name), product_variants(id, size, scent, inventory(id, stock_quantity, reorder_level))')
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
        return Math.max(max, Number(inv?.reorder_level || 10));
      }, 10);

      if (!variantRows.length) continue;

      rows.push({
        productId: p.id,
        inventoryId: variantRows[0].inventory?.id || variantRows[0].inventory?.[0]?.id || '',
        variantId: variantRows[0].id,
        product: p.name,
        variantLabel: variantRows.length > 1 ? `${variantRows.length} variants` : [variantRows[0].size, variantRows[0].scent].filter(Boolean).join(' / ') || 'Standard',
        brand: p.brands?.name || '',
        category: p.categories?.name || '',
        stock: sumStock,
        reorderLevel: maxReorder,
        image: p.image,
        variantCount: variantRows.length,
        isOutOfStock: variantRows.every((variant: any) => {
          const inv = toOne<{ stock_quantity: number }>(variant.inventory);
          return Number(inv?.stock_quantity || 0) === 0;
        }),
        isLowStock: variantRows.some((variant: any) => {
          const inv = toOne<{ stock_quantity: number; reorder_level: number }>(variant.inventory);
          return Number(inv?.stock_quantity || 0) > 0 && Number(inv?.stock_quantity || 0) < Number(inv?.reorder_level || 10);
        }),
        variantRows: variantRows.map((v: any) => {
          const inv = toOne<{ id: string; stock_quantity: number; reorder_level: number }>(v.inventory);
          return {
            inventoryId: inv?.id || '',
            variantId: v.id,
            variantLabel: [v.size, v.scent].filter(Boolean).join(' / ') || 'Standard',
            stock: Number(inv?.stock_quantity || 0),
            reorderLevel: Number(inv?.reorder_level || 10),
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
      .select('id, movement_no, variant_id, movement_type, quantity, reference, created_at, product_variants(size, scent, products(name), inventory(stock_quantity))')
      .order('created_at', { ascending: false })
      .limit(30);

    if (movementError) { setError(movementError.message); return; }
    setMovements((data || []).map((row: any) => ({
      id: row.id,
      movementNo: row.movement_no || row.id.slice(0, 8),
      product: row.product_variants?.products?.name || row.variant_id,
      type: row.movement_type,
      qty: row.quantity,
      currentStock: toOne<{ stock_quantity: number }>(row.product_variants?.inventory)?.stock_quantity ?? null,
      date: new Date(row.created_at).toLocaleDateString(),
      ref: row.reference || '',
    })));
  };

  useEffect(() => { void loadInventory(); void loadMovements(); }, []);

  const openModal = (type: 'in' | 'out') => {
    setModalType(type);
    setForm({ inventoryId: '', qty: '', ref: '', notes: '' });
    setModalOpen(true);
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const categories = ['All', ...Array.from(new Set(inventory.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b))];
  const categoryOptions = categories.filter(category => category !== 'All').map(category => ({
    value: category,
    label: category,
  }));

  const modalInventoryOptions = inventory
    .filter(item => selectedCategory === 'All' || item.category === selectedCategory)
    .flatMap(item => item.variantRows.map(variant => ({
      value: variant.inventoryId,
      label: `${item.category} · ${item.product} · ${variant.variantLabel} (${variant.stock} in stock)`,
    })));

  const submit = () => {
    const qty = parseInt(form.qty);
    if (!form.inventoryId) { addToast('error', 'Select a product.'); return; }
    if (!qty || qty <= 0) { addToast('error', 'Enter a valid quantity.'); return; }

    const parentRow = inventory.find(i => i.variantRows.some(variant => variant.inventoryId === form.inventoryId));
    const variantRow = parentRow?.variantRows.find(variant => variant.inventoryId === form.inventoryId);
    if (!parentRow || !variantRow) return;

    if (modalType === 'out' && qty > variantRow.stock) {
      addToast('error', `Cannot remove ${qty} units. Only ${variantRow.stock} in stock.`); return;
    }

    void (async () => {
      const { error: movementError } = await supabase.rpc('record_inventory_movement', {
        p_inventory_id: variantRow.inventoryId,
        p_movement_type: modalType === 'in' ? 'Stock In' : 'Stock Out',
        p_quantity: qty,
        p_reference: form.ref || null,
        p_notes: form.notes || null,
      });
      if (movementError) { addToast('error', movementError.message); return; }
      addToast('success', `${modalType === 'in' ? 'Stock added' : 'Stock removed'}: ${qty} units of ${parentRow.product} (${variantRow.variantLabel})`);
      setModalOpen(false);
      await Promise.all([loadInventory(), loadMovements()]);
    })();
  };

  const lowStockCount = inventory.filter(i => i.isLowStock && !i.isOutOfStock).length;
  const outCount = inventory.filter(i => i.isOutOfStock).length;
  const inStockCount = inventory.filter(i => !i.isOutOfStock && !i.isLowStock).length;
  const totalProducts = inventory.length;
  const totalUnits = inventory.reduce((sum, item) => sum + item.stock, 0);
  const filteredInventory = inventory.filter(item => selectedCategory === 'All' || item.category === selectedCategory);
  const displayInventory = filteredInventory.flatMap(item => item.variantRows.map(variant => ({
    ...item,
    inventoryId: variant.inventoryId,
    variantId: variant.variantId,
    variantLabel: variant.variantLabel,
    stock: variant.stock,
    reorderLevel: variant.reorderLevel,
    variantCount: 1,
    isOutOfStock: variant.stock === 0,
    isLowStock: variant.stock > 0 && variant.stock < variant.reorderLevel,
  })));

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        {loading && <p className="text-sm text-[var(--muted-foreground)]">Loading inventory...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Inventory</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Track and manage stock levels per product variant</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openModal('out')}><ArrowUp size={14} /> Stock Out</Button>
            <Button onClick={() => openModal('in')}><ArrowDown size={14} /> Stock In</Button>
          </div>
        </div>

        {(lowStockCount > 0 || outCount > 0) && (
          <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-lg)] p-4 flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              {lowStockCount > 0 && <><strong>{lowStockCount} item{lowStockCount > 1 ? 's' : ''}</strong> running low. </>}
              {outCount > 0 && <><strong>{outCount} item{outCount > 1 ? 's' : ''}</strong> out of stock.</>}
            </p>
          </div>
        )}

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Inventory Summary</p>
              <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">{totalProducts} products</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Total Stock', count: totalUnits, color: 'text-sky-600', subtle: 'bg-sky-50' },
                { label: 'In Stock', count: inStockCount, color: 'text-emerald-600', subtle: 'bg-emerald-50' },
                { label: 'Low Stock', count: lowStockCount, color: 'text-amber-600', subtle: 'bg-amber-50' },
                { label: 'Out of Stock', count: outCount, color: 'text-red-600', subtle: 'bg-red-50' },
              ].map((s) => (
                <div key={s.label} className={`${s.subtle} rounded-[var(--radius-lg)] px-3 py-2.5`}>
                  <div className={`text-2xl font-bold ${s.color}`}>{s.count}</div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted-foreground)] mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <div className="mb-4 overflow-x-auto">
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

          <DataTable
            data={displayInventory.map(i => ({
              ...i,
              _status: i.isOutOfStock
                ? { label: 'Out of Stock', variant: 'danger' as const }
                : i.isLowStock
                  ? { label: 'Low Stock', variant: 'warning' as const }
                  : { label: 'In Stock', variant: 'success' as const },
            })) as any}
            columns={[
              { key: 'product', label: 'Product', render: (row: any) => (
                <div className="flex items-center gap-3">
                  <img src={safeImage(row.image, row.product)} alt="" className="w-8 h-8 object-cover rounded bg-[var(--secondary)]" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--foreground)]">{row.product}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{row.brand} · {row.variantLabel}</div>
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
              { key: '_status', label: 'Status', render: (row: any) => <Badge variant={row._status.variant}>{row._status.label}</Badge> },
            ]}
          />
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <h2 className="font-semibold text-sm mb-4">Movement History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {['Reference', 'Product', 'Type', 'Quantity', 'Current Stock', 'Date', 'Document'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--secondary)] transition-colors">
                    <td className="px-3 py-3 font-mono text-xs text-[var(--muted-foreground)]">{m.movementNo}</td>
                    <td className="px-3 py-3 font-medium">{m.product}</td>
                    <td className="px-3 py-3">
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${m.type === 'Stock In' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {m.type === 'Stock In' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}{m.type}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono">{m.type === 'Stock Out' ? '-' : '+'}{m.qty}</td>
                    <td className="px-3 py-3 font-mono">{m.currentStock == null ? '—' : `${m.currentStock} units`}</td>
                    <td className="px-3 py-3 text-[var(--muted-foreground)] text-xs">{m.date}</td>
                    <td className="px-3 py-3 text-xs text-[var(--primary)] font-mono">{m.ref}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">No stock movements recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={modalType === 'in' ? 'Record Stock In' : 'Record Stock Out'}>
          <div className="flex flex-col gap-4">
            <Select
              label="Category *"
              value={selectedCategory}
              onChange={(e) => {
                const nextCategory = e.target.value;
                setSelectedCategory(nextCategory);
                const firstItem = inventory.find(item => nextCategory === 'All' ? true : item.category === nextCategory);
                setForm((prev) => ({ ...prev, inventoryId: firstItem?.variantRows[0]?.inventoryId || '' }));
              }}
              options={[{ value: 'All', label: 'All categories' }, ...categoryOptions]}
            />
            <Select
              label="Product Variant *"
              value={form.inventoryId}
              onChange={set('inventoryId')}
              options={[{ value: '', label: 'Select product variant…' }, ...modalInventoryOptions]}
            />
            <Input label="Quantity *" type="number" value={form.qty} onChange={set('qty')} placeholder="0" />
            <Input label={modalType === 'in' ? 'Purchase Order Ref.' : 'Sales Order Ref.'} value={form.ref} onChange={set('ref')} placeholder={modalType === 'in' ? 'PO-2026-XXXXXX' : 'ORD-2026-XXXXXX'} />
            <Input label="Notes (optional)" value={form.notes} onChange={set('notes')} placeholder="Any additional notes…" />
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
              <Button className="flex-1" onClick={submit}>Record {modalType === 'in' ? 'Stock In' : 'Stock Out'}</Button>
            </div>
          </div>
        </Modal>
      </div>
    </AdminSidebar>
  );
}
