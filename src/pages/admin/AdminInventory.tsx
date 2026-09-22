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
interface StockRow {
  inventoryId: string;
  variantId: string;
  product: string;
  variantLabel: string;
  brand: string;
  category: string;
  stock: number;
  reorderLevel: number;
  image: string;
}
interface Movement { id: string; movementNo: string; product: string; type: 'Stock In' | 'Stock Out'; qty: number; date: string; ref: string; }

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
  const [form, setForm] = useState({ inventoryId: '', qty: '', ref: '', notes: '' });
  const { toasts, add: addToast, remove } = useToast();

  const loadInventory = async () => {
    setLoading(true);
    setError(null);
    // Every product, every status (Draft/Archived stock still needs managing),
    // exploded to one row per variant so each has its own real inventory id.
    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id, name, image, brands(name), categories(name), product_variants(id, size, scent, inventory(id, stock_quantity, reorder_level))')
      .order('name');
    if (fetchError) { setError(fetchError.message); setLoading(false); return; }
    const rows: StockRow[] = [];
    for (const p of (data || []) as any[]) {
      for (const v of p.product_variants || []) {
        const inv = toOne<{ id: string; stock_quantity: number; reorder_level: number }>(v.inventory);
        if (!inv) continue; // no inventory row configured for this variant yet
        rows.push({
          inventoryId: inv.id,
          variantId: v.id,
          product: p.name,
          variantLabel: [v.size, v.scent].filter(Boolean).join(' / ') || 'Standard',
          brand: p.brands?.name || '',
          category: p.categories?.name || '',
          stock: Number(inv.stock_quantity || 0),
          reorderLevel: Number(inv.reorder_level || 10),
          image: p.image,
        });
      }
    }
    setInventory(rows);
    setLoading(false);
  };

  const loadMovements = async () => {
    const { data } = await supabase
      .from('inventory_movements')
      .select('id, movement_no, variant_id, movement_type, quantity, reference, created_at, product_variants(size, scent, products(name))')
      .order('created_at', { ascending: false })
      .limit(30);
    setMovements((data || []).map((row: any) => ({
      id: row.id,
      movementNo: row.movement_no || row.id.slice(0, 8),
      product: row.product_variants?.products?.name || row.variant_id,
      type: row.movement_type,
      qty: row.quantity,
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

  const submit = () => {
    const qty = parseInt(form.qty);
    if (!form.inventoryId) { addToast('error', 'Select a product.'); return; }
    if (!qty || qty <= 0) { addToast('error', 'Enter a valid quantity.'); return; }

    const row = inventory.find(i => i.inventoryId === form.inventoryId);
    if (!row) return;

    if (modalType === 'out' && qty > row.stock) {
      addToast('error', `Cannot remove ${qty} units. Only ${row.stock} in stock.`); return;
    }

    void (async () => {
      const nextStock = modalType === 'in' ? row.stock + qty : row.stock - qty;
      // Update the exact variant's inventory row — never an aggregate.
      const { error: stockError } = await supabase.from('inventory').update({ stock_quantity: nextStock, updated_at: new Date().toISOString() }).eq('id', row.inventoryId);
      if (stockError) { addToast('error', stockError.message); return; }
      const { error: movementError } = await supabase.from('inventory_movements').insert({ variant_id: row.variantId, movement_type: modalType === 'in' ? 'Stock In' : 'Stock Out', quantity: qty, reference: form.ref || null, notes: form.notes || null });
      if (movementError) { addToast('error', movementError.message); return; }
      addToast('success', `${modalType === 'in' ? 'Stock added' : 'Stock removed'}: ${qty} units of ${row.product} (${row.variantLabel})`);
      setModalOpen(false);
      await Promise.all([loadInventory(), loadMovements()]);
    })();
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const lowStockCount = inventory.filter(i => i.stock > 0 && i.stock < i.reorderLevel).length;
  const outCount = inventory.filter(i => i.stock === 0).length;

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

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'In Stock', count: inventory.filter(i => i.stock >= i.reorderLevel).length, color: 'text-emerald-600' },
            { label: 'Low Stock', count: lowStockCount, color: 'text-amber-600' },
            { label: 'Out of Stock', count: outCount, color: 'text-red-600' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-4 text-center">
              <div className={`text-3xl font-bold ${s.color}`}>{s.count}</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={inventory.map(i => ({ ...i, _status: getStatus(i.stock, i.reorderLevel) })) as any}
            columns={[
              { key: 'product', label: 'Product', render: (row: any) => (
                <div className="flex items-center gap-2">
                  <img src={safeImage(row.image, row.product)} alt="" className="w-8 h-8 object-cover rounded bg-[var(--secondary)]" />
                  <div>
                    <div className="text-sm font-medium">{row.product}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{row.brand} · {row.variantLabel}</div>
                  </div>
                </div>
              )},
              { key: 'category', label: 'Category' },
              { key: 'stock', label: 'Current Stock', render: (row: any) => (
                <div className="flex flex-col gap-1 min-w-24">
                  <span className="font-mono text-sm font-medium">{row.stock} units</span>
                  <ProgressBar value={row.stock} max={400} />
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
                  {['Reference', 'Product', 'Type', 'Quantity', 'Date', 'Document'].map(h => (
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
                    <td className="px-3 py-3 text-[var(--muted-foreground)] text-xs">{m.date}</td>
                    <td className="px-3 py-3 text-xs text-[var(--primary)] font-mono">{m.ref}</td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">No stock movements recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={modalType === 'in' ? 'Record Stock In' : 'Record Stock Out'}>
          <div className="flex flex-col gap-4">
            <Select
              label="Product Variant *"
              value={form.inventoryId}
              onChange={set('inventoryId')}
              options={[{ value: '', label: 'Select product variant…' }, ...inventory.map(i => ({ value: i.inventoryId, label: `${i.product} — ${i.variantLabel} (${i.stock} in stock)` }))]}
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
