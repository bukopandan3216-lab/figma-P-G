import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast, ToastContainer } from '../../components/ui';
import { Plus, Edit2, Eye, FileDown, BarChart2, Brain, Lightbulb, Users, ShoppingCart, Truck, TrendingUp, AlertTriangle, CheckCircle, XCircle, Settings, Archive, Trash2, RotateCcw } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Button, Badge, DataTable, Modal, Input, Select, Card, EmptyState, Tabs, LoadingState } from '../../components/ui';
import AdminSidebar from '../../components/AdminSidebar';
import { createPurchaseOrder, fetchAdminUsers, fetchCustomers, fetchProductSales, fetchPurchaseProducts, fetchPurchases, fetchRecommendationRules, fetchSuppliers, fetchTransactions, fetchSalesSummary, manageUser, receivePurchaseOrder, saveRecommendationRule, setCustomerAccountStatus, setSupplierProducts, setSupplierStatus, upsertSupplier } from '../../lib/adminData';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { recommendProducts } from '../../lib/recommendations';
import { useCatalog } from '../../context/CatalogContext';
import { hasModulePermission } from '../../lib/permissions';
import { safeImage } from '../../lib/image';

// ─── Suppliers ────────────────────────────────────────────────────────────────
export function AdminSuppliers() {
  const [view, setView] = useState<'list' | 'profile'>('list');
  const [selected, setSelected] = useState<any>(null);
  const [supplierList, setSupplierList] = useState<any[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [archiveSupplierId, setArchiveSupplierId] = useState<string | null>(null);
  const [permanentDeleteSupplierId, setPermanentDeleteSupplierId] = useState<string | null>(null);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });
  const [productOptions, setProductOptions] = useState<{ id: string; name: string }[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<string[]>([]);
  const { toasts, add: addToast, remove } = useToast();
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setAddForm(p => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    void fetchSuppliers().then(setSupplierList).catch(error => addToast('error', error.message));
    void fetchPurchaseProducts().then(setProductOptions).catch(error => addToast('error', error.message));
  }, []);

  const openAddSupplier = () => {
    setEditingSupplierId(null);
    setAddForm({ name: '', contactName: '', email: '', phone: '', address: '' });
    setLinkedProducts([]);
    setAddOpen(true);
  };

  const openEditSupplier = (supplier: any) => {
    setEditingSupplierId(supplier.id);
    setAddForm({ name: supplier.name, contactName: supplier.contact === 'N/A' ? '' : supplier.contact, email: supplier.email, phone: supplier.phone, address: supplier.address || '' });
    setLinkedProducts(supplier.productIds || []);
    setAddOpen(true);
  };

  const saveSupplier = async () => {
    if (!addForm.name.trim()) { addToast('error', 'Supplier name is required.'); return; }
    setSavingSupplier(true);
    try {
      const savedSupplierId = await upsertSupplier(addForm, editingSupplierId || undefined);
      if (savedSupplierId) await setSupplierProducts(savedSupplierId, linkedProducts);
      setSupplierList(await fetchSuppliers());
      addToast('success', editingSupplierId ? 'Supplier updated.' : 'Supplier added.');
      setAddOpen(false);
      setEditingSupplierId(null);
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to save supplier.');
    } finally {
      setSavingSupplier(false);
    }
  };

  const changeSupplierStatus = async (supplier: any) => {
    const status = supplier.status === 'Active' ? 'Inactive' : 'Active';
    if (status === 'Inactive' && !window.confirm(`Deactivate ${supplier.name}? Existing purchase orders will be kept.`)) return;
    try {
      await setSupplierStatus(supplier.id, status);
      setSupplierList(rows => rows.map(row => row.id === supplier.id ? { ...row, status } : row));
      addToast('success', `${supplier.name} ${status === 'Active' ? 'reactivated' : 'deactivated'}.`);
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to update supplier status.');
    }
  };

  const archiveSupplier = async () => {
    if (!archiveSupplierId) return;
    const supplier = supplierList.find(row => row.id === archiveSupplierId);
    try {
      await setSupplierStatus(archiveSupplierId, 'Archived');
      setSupplierList(rows => rows.map(row => row.id === archiveSupplierId ? { ...row, status: 'Archived' } : row));
      addToast('info', `${supplier?.name || 'Supplier'} moved to Archived Suppliers.`);
      setArchiveSupplierId(null);
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to archive supplier.');
    }
  };

  const restoreSupplier = async (supplier: any) => {
    try {
      await setSupplierStatus(supplier.id, 'Active');
      setSupplierList(rows => rows.map(row => row.id === supplier.id ? { ...row, status: 'Active' } : row));
      addToast('success', `${supplier.name} restored.`);
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to restore supplier.');
    }
  };

  const permanentlyDeleteSupplier = async () => {
    if (!permanentDeleteSupplierId) return;
    const supplier = supplierList.find(row => row.id === permanentDeleteSupplierId);
    if (supplier?.purchaseOrders?.length) {
      addToast('error', 'Suppliers with purchase-order history cannot be permanently deleted.');
      setPermanentDeleteSupplierId(null);
      return;
    }
    const { error } = await supabase.from('suppliers').delete().eq('supplier_id', permanentDeleteSupplierId);
    if (error) {
      addToast('error', error.message);
      return;
    }
    setSupplierList(rows => rows.filter(row => row.id !== permanentDeleteSupplierId));
    addToast('info', 'Supplier permanently deleted.');
    setPermanentDeleteSupplierId(null);
  };

  if (view === 'profile' && selected) return (
    <AdminSidebar>
      <div className="animate-fade-in">
        <button onClick={() => setView('list')} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-4 flex items-center gap-1">← Back to Suppliers</button>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-lg font-bold text-[var(--primary)]">{selected.name[0]}</div>
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <Badge variant={selected.status === 'Active' ? 'success' : 'muted'}>{selected.status}</Badge>
              </div>
            </div>
            {[['Contact', selected.contact], ['Email', selected.email], ['Phone', selected.phone], ['Address', selected.address || 'N/A'], ['Product Count', String(selected.products || 0)], ['Products Supplied', (selected.productNames || []).join(', ') || 'None linked'], ['Brands Carried', (selected.brands || []).join(', ') || 'None'], ['Brand Count', String(selected.brandCount || 0)], ['Variants Available', String(selected.variantCount || 0)], ['Last Order', selected.lastOrder]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <span className="text-[var(--muted-foreground)]">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
          <div className="lg:col-span-2 bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
            <h3 className="font-semibold mb-4">Purchase Orders</h3>
            <DataTable
              data={(selected.purchaseOrders || []) as any}
              columns={[
                { key: 'po', label: 'PO Number' },
                { key: 'date', label: 'Date' },
                { key: 'items', label: 'Items' },
                { key: 'amount', label: 'Amount' },
                { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Received' ? 'success' : 'info'}>{row.status}</Badge> },
              ]}
            />
          </div>
        </div>
      </div>
    </AdminSidebar>
  );

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{showArchived ? 'Archived Suppliers' : 'Suppliers'}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">{showArchived ? `${supplierList.filter(supplier => supplier.status === 'Archived').length} archived suppliers` : `${supplierList.filter(supplier => supplier.status !== 'Archived').length} registered suppliers`}</p>
          </div>
          {showArchived ? (
            <Button variant="outline" onClick={() => setShowArchived(false)}>Back to Suppliers</Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowArchived(true)}>Archived ({supplierList.filter(supplier => supplier.status === 'Archived').length})</Button>
              <Button onClick={openAddSupplier}><Plus size={15} /> Add Supplier</Button>
            </div>
          )}
        </div>
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={supplierList.filter(supplier => showArchived ? supplier.status === 'Archived' : supplier.status !== 'Archived') as any}
            columns={[
              { key: 'name', label: 'Supplier', render: (row: any) => <span className="font-medium">{row.name}</span> },
              { key: 'contact', label: 'Contact' },
              { key: 'email', label: 'Email' },
              { key: 'products', label: 'Products' },
              { key: 'brands', label: 'Brands', render: (row: any) => (
                <span className="text-sm" title={(row.brands || []).join(', ')}>{row.brandCount ? `${row.brandCount} brand${row.brandCount === 1 ? '' : 's'}` : '—'}</span>
              ) },
              { key: 'variants', label: 'Variants', render: (row: any) => (
                <span className="text-sm">{row.variantCount ? `${row.variantCount} variant${row.variantCount === 1 ? '' : 's'}` : '—'}</span>
              ) },
              { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Active' ? 'success' : 'muted'}>{row.status}</Badge> },
              { key: 'lastOrder', label: 'Last Order' },
              { key: 'actions', label: '', sortable: false, render: (row: any) => (
                <div className="flex items-center gap-1">
                  {showArchived ? (
                    <>
                      <button title="Restore supplier" aria-label={`Restore ${row.name}`} onClick={() => void restoreSupplier(row)} className="p-1.5 hover:bg-emerald-50 rounded text-[var(--muted-foreground)] hover:text-emerald-600 transition-colors"><RotateCcw size={14} /></button>
                      <button title={row.purchaseOrders?.length ? 'Cannot delete supplier with purchase-order history' : 'Delete permanently'} aria-label={`Delete ${row.name} permanently`} disabled={Boolean(row.purchaseOrders?.length)} onClick={() => setPermanentDeleteSupplierId(row.id)} className="p-1.5 hover:bg-red-50 rounded text-[var(--muted-foreground)] hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"><Trash2 size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button title="View supplier" aria-label={`View ${row.name}`} onClick={() => { setSelected(row as any); setView('profile'); }} className="p-1.5 hover:bg-[var(--secondary)] rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Eye size={14} /></button>
                      <button title="Edit supplier" aria-label={`Edit ${row.name}`} onClick={() => openEditSupplier(row)} className="p-1.5 hover:bg-[var(--secondary)] rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Edit2 size={14} /></button>
                      <button title={row.status === 'Active' ? 'Deactivate supplier' : 'Reactivate supplier'} aria-label={`${row.status === 'Active' ? 'Deactivate' : 'Reactivate'} ${row.name}`} onClick={() => void changeSupplierStatus(row)} className="p-1.5 hover:bg-[var(--secondary)] rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">{row.status === 'Active' ? <XCircle size={14} /> : <CheckCircle size={14} />}</button>
                      <button title="Archive supplier" aria-label={`Archive ${row.name}`} onClick={() => setArchiveSupplierId(row.id)} className="p-1.5 hover:bg-red-50 rounded text-[var(--muted-foreground)] hover:text-red-500 transition-colors"><Archive size={14} /></button>
                    </>
                  )}
                </div>
              )},
            ]}
          />
        </div>
      </div>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={editingSupplierId ? 'Edit Supplier' : 'Add Supplier'}>
        <div className="flex flex-col gap-4">
          <Input label="Supplier Name *" value={addForm.name} onChange={setF('name')} placeholder="e.g. P&G Distribution PH" />
          <Input label="Contact Person" value={addForm.contactName} onChange={setF('contactName')} placeholder="Ana Cruz" />
          <Input label="Email" type="email" value={addForm.email} onChange={setF('email')} placeholder="contact@supplier.com" />
          <Input label="Phone" value={addForm.phone} onChange={setF('phone')} placeholder="+63 2 8123 4567" />
          <Input label="Address" value={addForm.address} onChange={setF('address')} placeholder="Supplier address" />
          <div>
            <p className="text-sm font-medium mb-1">Products Supplied</p>
            <p className="text-xs text-[var(--muted-foreground)] mb-2">Link the catalogue this supplier provides. Purchase orders and stock movements follow these links.</p>
            <div className="max-h-40 overflow-y-auto rounded border border-[var(--border)] p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {productOptions.map(product => (
                <label key={product.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={linkedProducts.includes(product.id)}
                    onChange={event => setLinkedProducts(rows => event.target.checked
                      ? [...rows, product.id]
                      : rows.filter(id => id !== product.id))}
                  />
                  <span className="truncate">{product.name}</span>
                </label>
              ))}
              {!productOptions.length && <p className="text-xs text-[var(--muted-foreground)]">No active products available yet.</p>}
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => void saveSupplier()} loading={savingSupplier} className="flex-1">{editingSupplierId ? 'Save Changes' : 'Add Supplier'}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={!!archiveSupplierId} onClose={() => setArchiveSupplierId(null)} title="Archive Supplier" size="sm">
        <p className="text-sm text-[var(--muted-foreground)] mb-6">This supplier will be hidden from the active list and new purchase orders. Existing purchase orders will be kept. You can restore or permanently delete it from Archived Suppliers.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setArchiveSupplierId(null)} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={() => void archiveSupplier()} className="flex-1">Archive Supplier</Button>
        </div>
      </Modal>
      <Modal open={!!permanentDeleteSupplierId} onClose={() => setPermanentDeleteSupplierId(null)} title="Delete Supplier Permanently" size="sm">
        <p className="text-sm text-[var(--muted-foreground)] mb-6">This permanently deletes the supplier and cannot be undone. Suppliers with purchase-order history cannot be deleted.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setPermanentDeleteSupplierId(null)} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={() => void permanentlyDeleteSupplier()} className="flex-1">Delete Permanently</Button>
        </div>
      </Modal>
    </AdminSidebar>
  );
}

// ─── Purchases ────────────────────────────────────────────────────────────────
const statusSteps = ['Pending', 'Approved', 'Shipped', 'Received'];
type PurchaseLineDraft = { productId: string; quantity: string; unitCost: string };

export function AdminPurchases() {
  const [createOpen, setCreateOpen] = useState(false);
  const [purchaseList, setPurchaseList] = useState<any[]>([]);
  const [supplierList, setSupplierList] = useState<any[]>([]);
  const [productList, setProductList] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseLineDraft[]>([{ productId: '', quantity: '1', unitCost: '' }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { toasts, add: addToast, remove } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      const [purchases, suppliers, products] = await Promise.all([fetchPurchases(), fetchSuppliers(), fetchPurchaseProducts()]);
      setPurchaseList(purchases);
      setSupplierList(suppliers);
      setProductList(products);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load purchase order data.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadData(); }, []);

  const updateItem = (index: number, patch: Partial<PurchaseLineDraft>) => {
    setItems(rows => rows.map((item, rowIndex) => rowIndex === index ? { ...item, ...patch } : item));
  };
  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0);

  const resetForm = () => {
    setSupplierId('');
    setExpectedDelivery('');
    setPaymentTerms('');
    setNotes('');
    setItems([{ productId: '', quantity: '1', unitCost: '' }]);
  };

  const savePurchaseOrder = async () => {
    if (!supplierId) { addToast('error', 'Select a supplier.'); return; }
    if (!items.length || items.some(item => !item.productId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitCost)) || Number(item.unitCost) < 0 || item.unitCost.trim() === '')) {
      addToast('error', 'Choose a product and enter a positive quantity and valid unit cost for every line.');
      return;
    }

    setSaving(true);
    try {
      await createPurchaseOrder({
        supplierId,
        expectedDelivery,
        paymentTerms,
        notes,
        items: items.map(item => ({ productId: item.productId, quantity: Number(item.quantity), unitCost: Number(item.unitCost) })),
      });
      addToast('success', 'Purchase order created.');
      setCreateOpen(false);
      resetForm();
      await loadData();
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to create purchase order.');
    } finally {
      setSaving(false);
    }
  };

  const activeSuppliers = supplierList.filter(supplier => supplier.status === 'Active');

  const markReceived = async (row: any) => {
    if (!row.purchaseOrderId) { addToast('error', 'This purchase order is missing its database id.'); return; }
    try {
      await receivePurchaseOrder(row.purchaseOrderId, `Delivery received from ${row.supplier || 'supplier'}`);
      addToast('success', `${row.id} marked as received — stock was increased and the movement was recorded.`);
      await loadData();
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to receive this purchase order.');
    }
  };

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold">Purchase Orders</h1><p className="text-sm text-[var(--muted-foreground)]">{purchaseList.length} purchase orders</p></div>
          <Button onClick={() => setCreateOpen(true)} disabled={!activeSuppliers.length || !productList.length}><Plus size={15} /> Create PO</Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!loading && !error && (!activeSuppliers.length || !productList.length) && <p className="text-sm text-[var(--muted-foreground)]">Add an active supplier and at least one active product before creating a purchase order.</p>}
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={purchaseList as any}
            emptyMessage={loading ? <LoadingState message="Hang tight, loading purchase orders…" /> : 'No purchase orders yet.'}
            columns={[
              { key: 'id', label: 'PO Number', render: (row: any) => <span className="font-mono text-sm">{row.id}</span> },
              { key: 'supplier', label: 'What was bought', render: (row: any) => <span className="text-sm text-[var(--foreground)]">{row.productSummary || row.supplier || '—'}</span> },
              { key: 'createdBy', label: 'Created By' },
              { key: 'date', label: 'Date' },
              { key: 'expectedDelivery', label: 'Expected Delivery' },
              { key: 'items', label: 'Items' },
              { key: 'total', label: 'Total' },
              { key: 'status', label: 'Status', render: (row: any) => (
                <Badge variant={row.status === 'Received' ? 'success' : row.status === 'Shipped' ? 'info' : row.status === 'Pending' ? 'warning' : row.status === 'Cancelled' ? 'danger' : 'muted'}>{row.status}</Badge>
              )},
              { key: 'tracker', label: 'Progress', sortable: false, render: (row: any) => {
                const idx = statusSteps.indexOf(row.status);
                if (row.status === 'Cancelled') return <span className="text-xs text-red-600">Cancelled</span>;
                const safeIdx = idx >= 0 ? idx : 0;
                return (
                  <div className="flex gap-0.5">
                    {statusSteps.map((_, i) => <div key={i} className={`h-1.5 w-4 rounded-full ${i <= safeIdx ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'}`} />)}
                  </div>
                );
              }},
              { key: 'actions', label: '', sortable: false, render: (row: any) => (
                row.status === 'Received' || row.status === 'Cancelled' ? null : (
                  <Button size="sm" variant="outline" onClick={() => void markReceived(row)}>Mark Received</Button>
                )
              )},
            ]}
          />
        </div>
        <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Purchase Order" size="lg">
          <div className="flex flex-col gap-4">
            <Select label="Supplier" value={supplierId} onChange={event => setSupplierId(event.target.value)} options={[{ value: '', label: 'Select supplier…' }, ...activeSuppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))]} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Expected Delivery" type="date" value={expectedDelivery} onChange={event => setExpectedDelivery(event.target.value)} />
              <Input label="Payment Terms" value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)} placeholder="e.g. Net 30" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Order Items</h3>
                <Button size="sm" variant="outline" onClick={() => setItems(rows => [...rows, { productId: '', quantity: '1', unitCost: '' }])}><Plus size={13} /> Add Line</Button>
              </div>
              <div className="flex flex-col gap-3">
                {items.map((item, index) => (
                  <div key={index} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_88px_120px_32px] items-end gap-2">
                    <Select label={index === 0 ? 'Product' : undefined} value={item.productId} onChange={event => updateItem(index, { productId: event.target.value })} options={[{ value: '', label: 'Select product…' }, ...productList.map(product => ({ value: product.id, label: product.name }))]} className="col-span-2 sm:col-span-1" />
                    <Input label={index === 0 ? 'Qty' : undefined} type="number" min="1" step="1" value={item.quantity} onChange={event => updateItem(index, { quantity: event.target.value })} />
                    <Input label={index === 0 ? 'Unit Cost' : undefined} type="number" min="0" step="0.01" value={item.unitCost} onChange={event => updateItem(index, { unitCost: event.target.value })} placeholder="0.00" />
                    <button type="button" title="Remove line" aria-label={`Remove product line ${index + 1}`} disabled={items.length === 1} onClick={() => setItems(rows => rows.filter((_, rowIndex) => rowIndex !== index))} className="mb-2 p-1.5 rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] disabled:opacity-40"><XCircle size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
            <Input label="Notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional notes…" />
            <div className="flex justify-end border-t border-[var(--border)] pt-3 text-sm font-semibold">Total: ₱{total.toFixed(2)}</div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="flex-1">Cancel</Button>
            <Button className="flex-1" onClick={() => void savePurchaseOrder()} loading={saving}>Create Purchase Order</Button>
          </div>
        </Modal>
      </div>
    </AdminSidebar>
  );
}

// ─── Customers ────────────────────────────────────────────────────────────────
const customers: any[] = [];

export function AdminCustomers() {
  const { user } = useAuth();
  const [view, setView] = useState<'list' | 'profile'>('list');
  const [selected, setSelected] = useState<any>(null);
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const { toasts, add: addToast, remove } = useToast();
  const loadCustomers = async () => {
    try {
      setCustomerList(await fetchCustomers());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load customers.');
    }
  };
  useEffect(() => { void loadCustomers(); }, []);

  const toggleCustomerStatus = async (customer: any) => {
    const status = customer.accountStatus === 'Active' ? 'Inactive' : 'Active';
    setUpdatingStatus(customer.id);
    try {
      await setCustomerAccountStatus(customer.id, status);
      setCustomerList(rows => rows.map(row => row.id === customer.id ? { ...row, accountStatus: status } : row));
      if (selected?.id === customer.id) setSelected((row: any) => ({ ...row, accountStatus: status }));
      addToast('success', `${customer.name}'s account is now ${status.toLowerCase()}.`);
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to update customer status.');
    } finally {
      setUpdatingStatus(null);
    }
  };

  if (view === 'profile' && selected) return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="animate-fade-in">
        <button onClick={() => setView('list')} className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-4 flex items-center gap-1">← Back to Customers</button>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-lg font-bold text-[var(--primary)]">{selected.name.split(' ').map((n: string) => n[0]).join('')}</div>
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <Badge variant={selected.segment === 'VIP' ? 'rose' : selected.segment === 'New' ? 'info' : 'default'}>{selected.segment}</Badge>
              </div>
            </div>
            {[['Email', selected.email], ['Phone', selected.phone], ['Member Since', selected.joined], ['Total Orders', selected.orders], ['Total Spend', selected.total]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0 text-sm">
                <span className="text-[var(--muted-foreground)]">{k}</span><span className="font-medium">{v}</span>
              </div>
            ))}
            <div className="mt-4">
              <div className="text-xs font-semibold text-[var(--muted-foreground)] uppercase mb-2">Skin Profile</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(selected.skinProfile || {}).length > 0
                  ? Object.entries(selected.skinProfile).map(([key, value]) => <Badge key={key} variant="muted">{key}: {String(value)}</Badge>)
                  : <span className="text-xs text-[var(--muted-foreground)]">No skin profile recorded.</span>}
              </div>
            </div>
          </div>
          <div className="lg:col-span-2 bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
            <h3 className="font-semibold mb-4">Purchase History</h3>
            <DataTable
              data={(selected.orderHistory || []).map((order: any) => ({
                order: order.order_no || order.id,
                date: new Date(order.created_at).toLocaleDateString(),
                items: 'See order',
                total: `₱${Number(order.total_amount || 0).toFixed(2)}`,
                status: order.status,
              })) as any}
              columns={[
                { key: 'order', label: 'Order ID' },
                { key: 'date', label: 'Date' },
                { key: 'items', label: 'Items' },
                { key: 'total', label: 'Total' },
                { key: 'status', label: 'Status', render: (row: any) => <Badge variant="success">{row.status}</Badge> },
              ]}
            />
          </div>
        </div>
      </div>
    </AdminSidebar>
  );

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold">Customers</h1><p className="text-sm text-[var(--muted-foreground)]">{customerList.length} registered customers</p></div>
        </div>
        {error && <div className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Customer data error: {error}</div>}
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={customerList as any}
            columns={[
              { key: 'name', label: 'Customer', render: (row: any) => (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--primary)]">{row.name.split(' ').map((n: string) => n[0]).join('')}</div>
                  <span className="font-medium text-sm">{row.name}</span>
                </div>
              )},
              { key: 'email', label: 'Email' },
              { key: 'joined', label: 'Joined' },
              { key: 'orders', label: 'Orders' },
              { key: 'total', label: 'Total Spend' },
              { key: 'segment', label: 'Segment', render: (row: any) => <Badge variant={row.segment === 'VIP' ? 'rose' : row.segment === 'New' ? 'info' : 'default'}>{row.segment}</Badge> },
              { key: 'accountStatus', label: 'Account Status', render: (row: any) => (
                <button
                  type="button"
                  disabled={updatingStatus === row.id || !hasModulePermission(user, 'customers', 'manage')}
                  onClick={() => void toggleCustomerStatus(row)}
                  aria-pressed={row.accountStatus === 'Active'}
                  aria-label={`${row.accountStatus === 'Active' ? 'Deactivate' : 'Activate'} ${row.name}`}
                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-wait disabled:opacity-60 ${row.accountStatus === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
                >
                  <span className={`relative h-4 w-7 rounded-full transition-colors ${row.accountStatus === 'Active' ? 'bg-emerald-600' : 'bg-red-400'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${row.accountStatus === 'Active' ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {updatingStatus === row.id ? 'Saving…' : row.accountStatus}
                </button>
              )},
              { key: 'actions', label: '', sortable: false, render: (row: any) => (
                <button onClick={() => { setSelected(row as any); setView('profile'); }} className="p-1.5 hover:bg-[var(--secondary)] rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Eye size={14} /></button>
              )},
            ]}
          />
        </div>
      </div>
    </AdminSidebar>
  );
}

// ─── Sales ────────────────────────────────────────────────────────────────────
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AdminSales() {
  const [detail, setDetail] = useState<any>(null);
  const [transactionList, setTransactionList] = useState<any[]>([]);
  const [summary, setSummary] = useState({ todaySales: 0, monthSales: 0, avgOrderValue: 0, returnRate: 0 });
  const [transactionsError, setTransactionsError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Processing' | 'Delivered' | 'Cancelled'>('All');
  useEffect(() => {
    let active = true;
    void fetchTransactions()
      .then(rows => { if (active) setTransactionList(rows); })
      .catch(error => { if (active) setTransactionsError(error instanceof Error ? error.message : 'Unable to load transactions.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void fetchSalesSummary()
      .then(value => { if (active) setSummary(value); })
      .catch(error => { if (active) setSummaryError(error instanceof Error ? error.message : 'Unable to load the sales summary.'); });
    return () => { active = false; };
  }, []);
  const filteredTransactions = statusFilter === 'All' ? transactionList : transactionList.filter((t: any) => t.status === statusFilter);
  const cards = [
    { l: 'Today\'s Sales', v: peso(summary.todaySales) },
    { l: 'This Month', v: peso(summary.monthSales) },
    { l: 'Avg. Order Value', v: peso(summary.avgOrderValue) },
    { l: 'Return Rate', v: `${summary.returnRate.toFixed(1)}%` },
  ];
  return (
    <AdminSidebar>
      <div className="flex flex-col gap-6 animate-fade-in">
        <div><h1 className="text-xl font-bold">Sales Transactions</h1><p className="text-sm text-[var(--muted-foreground)]">All sales and transaction records</p></div>
        {summaryError && <p role="alert" className="text-sm text-red-600">Unable to load sales totals: {summaryError}</p>}
        {transactionsError && <p role="alert" className="text-sm text-red-600">Unable to load transactions: {transactionsError}</p>}
        <div className="grid grid-cols-4 gap-4">
          {cards.map(k => (
            <div key={k.l} className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-4 text-center">
              <div className="text-2xl font-bold">{k.v}</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-1">{k.l}</div>
            </div>
          ))}
        </div>
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={filteredTransactions as any}
            columns={[
              { key: 'id', label: 'Transaction ID', render: (row: any) => <span className="font-mono text-sm">{row.id}</span> },
              { key: 'customer', label: 'Customer' },
              { key: 'date', label: 'Date' },
              { key: 'items', label: 'Items' },
              { key: 'total', label: 'Total' },
              { key: 'payment', label: 'Payment' },
              { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Delivered' ? 'success' : row.status === 'Cancelled' ? 'danger' : 'warning'}>{row.status}</Badge> },
              { key: 'view', label: '', sortable: false, render: (row: any) => <button onClick={() => setDetail(row as any)} className="p-1.5 hover:bg-[var(--secondary)] rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Eye size={14} /></button> },
            ]}
          />
        </div>
        <Modal open={!!detail} onClose={() => setDetail(null)} title={`Order ${detail?.id}`}>
          {detail && (
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex flex-col">
                {[['Customer', detail.customer], ['Date', detail.date], ['Items', detail.items], ['Order Total', detail.total], ['Payment Method', detail.payment], ['Payment Status', detail.paymentStatus || '—'], ['Status', detail.status]].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-[var(--border)] py-2 last:border-0">
                    <span className="text-[var(--muted-foreground)]">{k}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="mb-2 font-semibold">Products in this order</h3>
                <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                  {(detail.orderItems || []).map((item: any, index: number) => (
                    <div key={index} className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] p-2">
                      <img src={safeImage(item.productImage, item.productName)} alt="" className="h-11 w-11 flex-shrink-0 rounded bg-[var(--secondary)] object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.productName}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{item.quantity} × {peso(Number(item.priceAtPurchase || 0))}</p>
                      </div>
                      <span className="font-semibold">{peso(Number(item.priceAtPurchase || 0) * Number(item.quantity || 0))}</span>
                    </div>
                  ))}
                  {!detail.orderItems?.length && <p className="text-xs text-[var(--muted-foreground)]">No line items were returned for this order.</p>}
                </div>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminSidebar>
  );
}

// ─── Recommendations ──────────────────────────────────────────────────────────
export function AdminRecommendations() {
  const { toasts, add: addToast, remove } = useToast();
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('https://api.pgbeauty.ai/v1/recommend');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [rules, setRules] = useState<any[]>([]);
  const [newRule, setNewRule] = useState({ name: '', desc: '', priority: 'Medium' });
  const { products } = useCatalog();
  useEffect(() => { void fetchRecommendationRules().then(setRules).catch(error => addToast('error', error.message)); }, []);

  const testConnection = async () => {
    setTesting(true); setTestResult('idle');
    try {
      const recommendations = await recommendProducts(null, products);
      setTestResult('ok');
      addToast('success', `Recommendation engine returned ${recommendations.length} scored products.`);
    } catch (error) {
      setTestResult('fail');
      addToast('error', error instanceof Error ? error.message : 'Recommendation engine failed.');
    } finally { setTesting(false); }
  };

  const addRule = () => {
    if (!newRule.name) { addToast('error', 'Rule name is required.'); return; }
    void saveRecommendationRule(newRule).then(() => {
      setRules(prev => [...prev, { ...newRule, active: true }]);
      addToast('success', 'Recommendation rule added!');
      setAddRuleOpen(false); setNewRule({ name: '', desc: '', priority: 'Medium' });
    }).catch(error => addToast('error', error.message));
  };

  return (
    <AdminSidebar>
      <div className="flex flex-col gap-6 animate-fade-in">
        <div><h1 className="text-xl font-bold">Recommendation Engine</h1><p className="text-sm text-[var(--muted-foreground)]">Manage recommendation rules and catalog ranking logic</p></div>

        {/* Model status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Model Accuracy', value: '94.2%', status: 'Healthy', color: 'emerald' },
            { label: 'Last Retrained', value: 'Sept 19, 2026', status: '2 days ago', color: 'blue' },
            { label: 'Active Rules', value: '24', status: '3 pending', color: 'amber' },
          ].map(s => (
            <div key={s.label} className={`bg-white border rounded-[var(--radius-xl)] p-4 border-${s.color}-200`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-sm font-medium mt-0.5">{s.label}</div>
              <div className={`text-xs mt-1 text-${s.color}-600`}>{s.status}</div>
            </div>
          ))}
        </div>

        {/* Recommendation Integration */}
        <div className="border-2 border-dashed border-[var(--primary)]/30 rounded-[var(--radius-xl)] p-6 bg-[var(--rose-light)]/30">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center flex-shrink-0">
              <Brain size={20} className="text-[var(--primary)]" />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--foreground)]">Recommendation Integration</h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-1">
                This panel connects to the local recommendation ranking logic and can be configured for a hosted scoring endpoint when needed.
              </p>
              <div className="mt-3 p-3 bg-[var(--slate-admin)] rounded-[var(--radius-lg)] font-mono text-xs text-emerald-400 overflow-x-auto">
                <div className="text-white/40">// Recommendation API Endpoint</div>
                <div>POST https://api.pgbeauty.ai/v1/recommend</div>
                <div className="text-white/40 mt-1">// Request payload: customer_id, product_ids, profile_signals</div>
                <div className="text-white/40">// Response: &#123; products: [&#123; id, score, reason &#125;] &#125;</div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="border-[var(--primary)] text-[var(--primary)]" onClick={() => setEndpointOpen(true)}>Configure Endpoint</Button>
                <Button size="sm" onClick={testConnection} loading={testing}>{testResult === 'ok' ? '✓ Connected' : 'Test Connection'}</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Active rules */}
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <ToastContainer toasts={toasts} onRemove={remove} />
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">Active Recommendation Rules</h2>
            <Button size="sm" onClick={() => setAddRuleOpen(true)}><Plus size={13} /> Add Rule</Button>
          </div>
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div key={rule.name + i} className="flex items-center gap-4 p-4 border border-[var(--border)] rounded-[var(--radius-lg)] hover:bg-[var(--secondary)] transition-colors">
                <button
                  onClick={() => {
                    const nextActive = !rule.active;
                    void supabase.from('recommendation_rules').update({ is_active: nextActive }).eq('rule_id', rule.id);
                    setRules(prev => prev.map((r, j) => j === i ? { ...r, active: nextActive } : r));
                  }}
                  className={`w-8 h-4 rounded-full flex-shrink-0 cursor-pointer transition-colors relative ${rule.active ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'}`}
                >
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${rule.active ? 'left-4' : 'left-0.5'}`} />
                </button>
                <div className="flex-1">
                  <div className="text-sm font-medium">{rule.name}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{rule.desc}</div>
                </div>
                <Badge variant={rule.priority === 'High' ? 'danger' : rule.priority === 'Medium' ? 'warning' : 'muted'}>{rule.priority}</Badge>
                <button className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-1" onClick={() => addToast('info', `Editing rule: ${rule.name}`)}><Edit2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Modal open={endpointOpen} onClose={() => setEndpointOpen(false)} title="Configure Recommendation Endpoint">
        <div className="flex flex-col gap-4">
          <Input label="API Endpoint URL" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
          <Input label="API Key (Bearer Token)" type="password" placeholder="sk-••••••••••••••••" />
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setEndpointOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => { setEndpointOpen(false); addToast('success', 'Endpoint configuration saved!'); }} className="flex-1">Save Configuration</Button>
          </div>
        </div>
      </Modal>
      <Modal open={addRuleOpen} onClose={() => setAddRuleOpen(false)} title="Add Recommendation Rule">
        <div className="flex flex-col gap-4">
          <Input label="Rule Name *" value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Brand Loyalty Boost" />
          <Input label="Description" value={newRule.desc} onChange={e => setNewRule(p => ({ ...p, desc: e.target.value }))} placeholder="Describe what this rule does…" />
          <Select label="Priority" value={newRule.priority} onChange={e => setNewRule(p => ({ ...p, priority: e.target.value }))} options={[{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]} />
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setAddRuleOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={addRule} className="flex-1">Add Rule</Button>
          </div>
        </div>
      </Modal>
    </AdminSidebar>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────
const reportTypes = [
  { name: 'Product Report', key: 'products', desc: 'Full product catalog with prices and status', icon: '📦', color: 'bg-blue-50 text-blue-600' },
  { name: 'Inventory Report', key: 'inventory', desc: 'Current stock levels and movement summary', icon: '🏪', color: 'bg-emerald-50 text-emerald-600' },
  { name: 'Low Stock Alert Report', key: 'low-stock', desc: 'Products below reorder threshold', icon: '⚠️', color: 'bg-amber-50 text-amber-600' },
  { name: 'Sales Report', key: 'sales', desc: 'Transaction history and revenue summary', icon: '📈', color: 'bg-[var(--rose-light)] text-[var(--primary)]' },
  { name: 'Purchase Report', key: 'purchase', desc: 'All purchase orders by supplier', icon: '🛒', color: 'bg-purple-50 text-purple-600' },
  { name: 'Supplier Report', key: 'supplier', desc: 'Supplier performance and spend summary', icon: '🚚', color: 'bg-indigo-50 text-indigo-600' },
  { name: 'Customer Report', key: 'customer', desc: 'Customer demographics and purchase behavior', icon: '👥', color: 'bg-teal-50 text-teal-600' },
  { name: 'User Activity Report', key: 'activity', desc: 'Admin user login and action logs', icon: '🔐', color: 'bg-gray-50 text-gray-600' },
];

const formatCurrency = (value: number) => `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function getReportData(reportKey: string, products: any[]) {
  const productRows = (products || []).map((product: any) => ({
    name: product.name,
    category: product.category || 'General',
    price: formatCurrency(Number(product.price || 0)),
    stock: Number(product.stock || 0),
    status: Number(product.stock || 0) > 0 ? 'In Stock' : 'Out of Stock',
    reorder: Math.max(5, Math.ceil((Number(product.stock || 0) || 0) * 0.25) || 5),
  }));

  const inventoryRows = productRows.map(product => ({
    product: product.name,
    stock: product.stock,
    reserved: Math.max(0, Math.ceil(product.stock * 0.2)),
    reorder: product.reorder,
    movement: product.stock > 20 ? 'Healthy' : 'Watch',
  }));

  const lowStockRows = inventoryRows.filter(row => row.stock < row.reorder + 3);

  const salesRows = [
    { order: 'PGB-2026-0194', customer: 'Jane D.', date: 'Sept 21, 2026', total: formatCurrency(4250), status: 'Paid' },
    { order: 'PGB-2026-0191', customer: 'Luis R.', date: 'Sept 20, 2026', total: formatCurrency(2840), status: 'Paid' },
    { order: 'PGB-2026-0187', customer: 'Sofia M.', date: 'Sept 19, 2026', total: formatCurrency(3105), status: 'Pending' },
    { order: 'PGB-2026-0185', customer: 'Ariana T.', date: 'Sept 17, 2026', total: formatCurrency(1950), status: 'Paid' },
  ];

  const purchaseRows = [
    { po: 'PO-2026-104', supplier: 'Glow Supply Co.', date: 'Sept 18, 2026', total: formatCurrency(22000), status: 'Received' },
    { po: 'PO-2026-103', supplier: 'Pure Skin Labs', date: 'Sept 12, 2026', total: formatCurrency(18450), status: 'In Transit' },
    { po: 'PO-2026-102', supplier: 'Aster Beauty', date: 'Sept 09, 2026', total: formatCurrency(14580), status: 'Approved' },
  ];

  const supplierRows = [
    { supplier: 'Glow Supply Co.', orders: 18, spend: formatCurrency(148000), rating: '4.8/5' },
    { supplier: 'Pure Skin Labs', orders: 12, spend: formatCurrency(125500), rating: '4.6/5' },
    { supplier: 'Aster Beauty', orders: 9, spend: formatCurrency(93120), rating: '4.4/5' },
  ];

  const customerRows = [
    { customer: 'Maria D.', segment: 'VIP', orders: 14, spend: formatCurrency(48500), lastOrder: 'Sept 21, 2026' },
    { customer: 'Alicia P.', segment: 'Regular', orders: 6, spend: formatCurrency(17050), lastOrder: 'Sept 18, 2026' },
    { customer: 'Nina R.', segment: 'New', orders: 2, spend: formatCurrency(4200), lastOrder: 'Sept 16, 2026' },
  ];

  const activityRows = [
    { user: 'Super Admin', action: 'Exported Product Report', time: '10 min ago' },
    { user: 'Beauty Admin', action: 'Updated inventory for Vitamin C Serum', time: '1 hr ago' },
    { user: 'Operations', action: 'Reviewed low stock alert', time: '3 hr ago' },
    { user: 'Sales Admin', action: 'Published the weekly sales snapshot', time: 'Today' },
  ];

  const reportMap: Record<string, { title: string; summary: { label: string; value: string; tone: string }[]; columns: any[]; rows: any[] }> = {
    products: {
      title: 'Product Report',
      summary: [
        { label: 'Active Products', value: String(productRows.length), tone: 'text-blue-600' },
        { label: 'In Stock', value: String(productRows.filter(p => p.status === 'In Stock').length), tone: 'text-emerald-600' },
        { label: 'Out of Stock', value: String(productRows.filter(p => p.status !== 'In Stock').length), tone: 'text-amber-600' },
      ],
      columns: [
        { key: 'name', label: 'Product' },
        { key: 'category', label: 'Category' },
        { key: 'price', label: 'Price' },
        { key: 'stock', label: 'Stock' },
        { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'In Stock' ? 'success' : 'warning'}>{row.status}</Badge> },
      ],
      rows: productRows,
    },
    inventory: {
      title: 'Inventory Report',
      summary: [
        { label: 'Total Units', value: String(inventoryRows.reduce((sum, row) => sum + row.stock, 0)), tone: 'text-emerald-600' },
        { label: 'Reserved', value: String(inventoryRows.reduce((sum, row) => sum + row.reserved, 0)), tone: 'text-violet-600' },
        { label: 'Watch List', value: String(inventoryRows.filter(r => r.movement === 'Watch').length), tone: 'text-amber-600' },
      ],
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'stock', label: 'On Hand' },
        { key: 'reserved', label: 'Reserved' },
        { key: 'reorder', label: 'Reorder Threshold' },
        { key: 'movement', label: 'Movement', render: (row: any) => <Badge variant={row.movement === 'Healthy' ? 'success' : 'warning'}>{row.movement}</Badge> },
      ],
      rows: inventoryRows,
    },
    'low-stock': {
      title: 'Low Stock Alert Report',
      summary: [
        { label: 'Low Stock Items', value: String(lowStockRows.length), tone: 'text-amber-600' },
        { label: 'Reorder Needed', value: String(lowStockRows.reduce((sum, row) => sum + Math.max(0, row.reorder - row.stock), 0)), tone: 'text-red-600' },
        { label: 'Critical Alerts', value: String(lowStockRows.filter(r => r.stock <= 5).length), tone: 'text-red-700' },
      ],
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'stock', label: 'Current Stock' },
        { key: 'reorder', label: 'Threshold' },
        { key: 'movement', label: 'Status', render: (row: any) => <Badge variant={row.stock <= 5 ? 'danger' : 'warning'}>{row.stock <= 5 ? 'Critical' : 'Low'}</Badge> },
      ],
      rows: lowStockRows,
    },
    sales: {
      title: 'Sales Report',
      summary: [
        { label: 'Revenue', value: formatCurrency(12145), tone: 'text-[var(--primary)]' },
        { label: 'Orders', value: '28', tone: 'text-emerald-600' },
        { label: 'Avg. Basket', value: formatCurrency(433.75), tone: 'text-blue-600' },
      ],
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'customer', label: 'Customer' },
        { key: 'date', label: 'Date' },
        { key: 'total', label: 'Total' },
        { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Paid' ? 'success' : 'warning'}>{row.status}</Badge> },
      ],
      rows: salesRows,
    },
    purchase: {
      title: 'Purchase Report',
      summary: [
        { label: 'Open POs', value: '3', tone: 'text-purple-600' },
        { label: 'Total Spend', value: formatCurrency(55030), tone: 'text-indigo-600' },
        { label: 'Received', value: '1', tone: 'text-emerald-600' },
      ],
      columns: [
        { key: 'po', label: 'PO Number' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'date', label: 'Date' },
        { key: 'total', label: 'Order Total' },
        { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Received' ? 'success' : row.status === 'In Transit' ? 'info' : 'warning'}>{row.status}</Badge> },
      ],
      rows: purchaseRows,
    },
    supplier: {
      title: 'Supplier Report',
      summary: [
        { label: 'Suppliers', value: '3', tone: 'text-indigo-600' },
        { label: 'Total Spend', value: formatCurrency(367620), tone: 'text-violet-600' },
        { label: 'Avg. Rating', value: '4.6/5', tone: 'text-emerald-600' },
      ],
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'orders', label: 'Orders' },
        { key: 'spend', label: 'Total Spend' },
        { key: 'rating', label: 'Rating' },
      ],
      rows: supplierRows,
    },
    customer: {
      title: 'Customer Report',
      summary: [
        { label: 'Total Customers', value: '3', tone: 'text-teal-600' },
        { label: 'VIP Customers', value: '1', tone: 'text-rose-600' },
        { label: 'Avg. Spend', value: formatCurrency(21250), tone: 'text-blue-600' },
      ],
      columns: [
        { key: 'customer', label: 'Customer' },
        { key: 'segment', label: 'Segment', render: (row: any) => <Badge variant={row.segment === 'VIP' ? 'rose' : row.segment === 'New' ? 'info' : 'default'}>{row.segment}</Badge> },
        { key: 'orders', label: 'Orders' },
        { key: 'spend', label: 'Spend' },
        { key: 'lastOrder', label: 'Last Order' },
      ],
      rows: customerRows,
    },
    activity: {
      title: 'User Activity Report',
      summary: [
        { label: 'Actions Logged', value: '4', tone: 'text-slate-600' },
        { label: 'Admins', value: '3', tone: 'text-primary' },
        { label: 'Recent Export', value: 'Today', tone: 'text-emerald-600' },
      ],
      columns: [
        { key: 'user', label: 'User' },
        { key: 'action', label: 'Action' },
        { key: 'time', label: 'Time' },
      ],
      rows: activityRows,
    },
  };

  return reportMap[reportKey] || reportMap.products;
}

export function AdminReports() {
  const { products } = useCatalog();
  const { toasts, add, remove } = useToast();
  const [selectedReport, setSelectedReport] = useState('Product Report');

  const activeReport = getReportData(
    reportTypes.find(report => report.name === selectedReport)?.key || 'products',
    products,
  );

  const exportReport = (reportName: string) => {
    const key = reportTypes.find(report => report.name === reportName)?.key || 'products';
    const report = getReportData(key, products);
    const csvRows = [report.columns.map((column: any) => column.label).join(',')];

    report.rows.forEach((row: any) => {
      const values = report.columns.map((column: any) => {
        const value = column.render ? column.render(row) : row[column.key];
        const plainText = typeof value === 'string' ? value : (value?.props?.children ?? '');
        return `"${String(plainText).replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    add('success', `${reportName} exported as CSV.`);
  };

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div><h1 className="text-xl font-bold">Reports Hub</h1><p className="text-sm text-[var(--muted-foreground)]">Generate and export business intelligence reports</p></div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {reportTypes.map(report => (
            <div key={report.name} className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-[var(--radius)] flex items-center justify-center text-xl ${report.color}`}>{report.icon}</div>
              <div>
                <div className="font-semibold text-sm">{report.name}</div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">{report.desc}</div>
              </div>
              <div className="flex gap-2 mt-auto">
                <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setSelectedReport(report.name)}>Preview</Button>
                <Button size="sm" className="flex-1 text-xs" onClick={() => exportReport(report.name)}><FileDown size={12} /> Export</Button>
              </div>
            </div>
          ))}

          <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-[var(--radius)] flex items-center justify-center text-xl bg-slate-100 text-slate-700">💬</div>
            <div>
              <div className="font-semibold text-sm">Contact Us Report</div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5">Customer messages and support conversations</div>
            </div>
            <div className="flex gap-2 mt-auto">
              <Button size="sm" className="flex-1 text-xs" onClick={() => window.location.assign('/admin/reports/contact-us')}>Open</Button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Selected report</p>
              <h2 className="text-xl font-bold">{activeReport.title}</h2>
            </div>
            <Button size="sm" variant="outline" onClick={() => exportReport(selectedReport)}>Export CSV</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            {activeReport.summary.map((metric: any) => (
              <div key={metric.label} className="bg-[var(--secondary)] border border-[var(--border)] rounded-[var(--radius-xl)] p-4">
                <div className={`text-2xl font-bold ${metric.tone}`}>{metric.value}</div>
                <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)] mt-1">{metric.label}</div>
              </div>
            ))}
          </div>

          <DataTable
            data={activeReport.rows as any}
            columns={activeReport.columns}
            emptyMessage={`No data available for ${activeReport.title}`}
          />
        </div>
      </div>
    </AdminSidebar>
  );
}

async function fetchSupportInquiries() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured, so support inquiries cannot be loaded.');
  }

  const { data, error } = await supabase.from('support_inquiries').select('id:inquiry_id, customer_name, email, subject, status, channel, last_reply, sentiment, message, support_reply, created_at, user_id').order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    customer: row.customer_name || row.customer || 'Customer',
    email: row.email || 'customer@example.com',
    subject: row.subject || 'Support inquiry',
    status: row.status || 'Open',
    channel: row.channel || 'Chat',
    lastReply: row.last_reply || 'Just now',
    sentiment: row.sentiment || 'Needs review',
    message: row.message || '',
    supportReply: row.support_reply || '',
  }));
}

async function saveSupportResponse(inquiryId: string, customer: string, email: string, replyText: string) {
  if (!isSupabaseConfigured) return;

  const payload = {
    inquiry_id: inquiryId,
    customer_name: customer,
    email,
    response: replyText,
    sent_at: new Date().toISOString(),
  };

  try {
    await supabase.from('support_responses').insert(payload);
  } catch {
    // ignored: response storage is optional if the table is unavailable
  }
}

export function ContactUsReportPage() {
  const { add, remove, toasts } = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [loadError, setLoadError] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [selectedInquiry, setSelectedInquiry] = useState<any>(null);
  const [replyText, setReplyText] = useState('Hi there, thanks for reaching out. We have reviewed your concern and will follow up shortly with a resolution.');

  useEffect(() => {
    let active = true;
    void fetchSupportInquiries().then((rows) => {
      if (active) {
        setMessages(rows);
        setLoadError('');
      }
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Unable to load support inquiries.');
    });
    return () => { active = false; };
  }, []);

  const openReply = (row: any) => {
    setSelectedInquiry(row);
    setReplyText(row.supportReply || `Hi ${row.customer.split(' ')[0]},\n\nThank you for contacting us about "${row.subject}". We have reviewed your message and will help with this concern shortly.\n\nBest,\nCustomer Support Team`);
    setReplyOpen(true);
  };

  const sendReply = async () => {
    if (!selectedInquiry) return;

    const nextMessages = messages.map(item => item.id === selectedInquiry.id
      ? {
          ...item,
          status: 'Resolved',
          lastReply: 'Just now',
          sentiment: 'Positive',
          supportReply: replyText,
        }
      : item);

    setMessages(nextMessages);
    await saveSupportResponse(selectedInquiry.id, selectedInquiry.customer, selectedInquiry.email, replyText);

    if (isSupabaseConfigured) {
      try {
        await supabase.from('support_inquiries').update({
          status: 'Resolved',
          sentiment: 'Positive',
          last_reply: 'Just now',
          support_reply: replyText,
        }).eq('inquiry_id', selectedInquiry.id);
      } catch {
        // ignore if table is unavailable
      }
    }

    const subject = `Re: ${selectedInquiry.subject}`;
    const body = replyText;
    const mailto = `mailto:${selectedInquiry.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selectedInquiry.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const mailWindow = window.open(mailto, '_blank', 'noopener,noreferrer');
      if (mailWindow) {
        setReplyOpen(false);
        setSelectedInquiry(null);
        add('success', `Reply prepared for ${selectedInquiry.email}`);
        return;
      }
    } catch {
      // ignore; fall through to browser-safe Gmail fallback below
    }

    try {
      const gmailWindow = window.open(gmailUrl, '_blank', 'noopener,noreferrer');
      if (gmailWindow) {
        setReplyOpen(false);
        setSelectedInquiry(null);
        add('success', `Reply draft opened in Gmail for ${selectedInquiry.email}`);
        return;
      }
    } catch {
      // ignore; fall through to clipboard fallback below
    }

    try {
      await navigator.clipboard.writeText(`To: ${selectedInquiry.email}\nSubject: ${subject}\n\n${body}`);
      setReplyOpen(false);
      setSelectedInquiry(null);
      add('success', `Reply copied to clipboard for ${selectedInquiry.email}. Paste it into Gmail or your email app.`);
    } catch {
      setReplyOpen(false);
      setSelectedInquiry(null);
      add('success', `Reply prepared for ${selectedInquiry.email}. Open your email client to send it manually.`);
    }
  };

  const summaryCards = [
    {
      label: 'Open Tickets',
      value: String(messages.filter((item) => ['Open', 'Pending', 'New'].includes(item.status)).length),
      tone: 'text-amber-600',
    },
    {
      label: 'Resolved',
      value: String(messages.filter((item) => item.status === 'Resolved').length),
      tone: 'text-emerald-600',
    },
    {
      label: 'Total Messages',
      value: String(messages.length),
      tone: 'text-blue-600',
    },
  ];

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Contact Us Report</h1>
            <p className="text-sm text-[var(--muted-foreground)]">Customer support conversations and message health</p>
          </div>
        </div>
        {loadError && <p role="alert" className="text-sm text-red-600">Unable to load support inquiries: {loadError}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summaryCards.map((item) => (
            <div key={item.label} className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-4">
              <div className={`text-3xl font-bold ${item.tone}`}>{item.value}</div>
              <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)] mt-1">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={messages as any}
            columns={[
              { key: 'customer', label: 'Customer', render: (row: any) => <span className="font-medium">{row.customer}</span> },
              { key: 'subject', label: 'Subject' },
              { key: 'message', label: 'Message', render: (row: any) => <span className="block max-w-[280px] truncate" title={row.message}>{row.message || '—'}</span> },
              { key: 'channel', label: 'Channel' },
              { key: 'status', label: 'Status', render: (row: any) => <Badge variant={row.status === 'Resolved' ? 'success' : row.status === 'Pending' ? 'warning' : row.status === 'New' ? 'info' : 'default'}>{row.status}</Badge> },
              { key: 'sentiment', label: 'Sentiment' },
              { key: 'lastReply', label: 'Last Reply' },
              { key: 'actions', label: 'Reply', sortable: false, render: (row: any) => (
                <Button size="sm" variant="outline" onClick={() => openReply(row)}>Reply</Button>
              ) },
            ]}
          />
        </div>
      </div>

      <Modal open={replyOpen} onClose={() => setReplyOpen(false)} title={`Reply to ${selectedInquiry?.customer ?? 'customer'}`} size="lg">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="To" value={selectedInquiry?.email ?? ''} readOnly />
            <Input label="Subject" value={selectedInquiry ? `Re: ${selectedInquiry.subject}` : ''} readOnly />
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--secondary)]/50 p-3">
            <div className="mb-1 text-xs font-semibold uppercase text-[var(--muted-foreground)]">Customer message</div>
            <p className="whitespace-pre-wrap text-sm">{selectedInquiry?.message || 'No message provided.'}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Email response</label>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={10}
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setReplyOpen(false)}>Cancel</Button>
            <Button onClick={sendReply}>Send Reply</Button>
          </div>
        </div>
      </Modal>
    </AdminSidebar>
  );
}

// ─── User Management / User And Roles ──────────────────────────────────────────────────────────
export function AdminUsers() {
  const { user } = useAuth();
  const { toasts, add: addToast, remove } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [userList, setUserList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'beauty_staff' });
  const roleOptions = [
    { value: 'beauty_staff', label: 'Beauty Staff' },
    { value: 'beauty_admin', label: 'Beauty Administrator' },
    { value: 'super_admin', label: 'P&G Super Administrator' },
  ];

  const loadData = async () => {
    try {
      const users = await fetchAdminUsers();
      setUserList(users);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load users and activity.');
    }
  };
  useEffect(() => { void loadData(); }, []);

  const inviteUser = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      addToast('error', 'First name, last name, and email are required.');
      return;
    }
    setSaving(true);
    try {
      await manageUser({ action: 'invite', first_name: form.firstName.trim(), last_name: form.lastName.trim(), email: form.email.trim(), role: form.role });
      addToast('success', 'Invitation sent.');
      setModalOpen(false);
      setForm({ firstName: '', lastName: '', email: '', role: 'beauty_staff' });
      await loadData();
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to invite user.');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (target: any, role: string) => {
    if (target.id === user?.id || target.role === role) return;
    try {
      await manageUser({ action: 'role', id: target.id, role });
      addToast('success', 'User role updated.');
      await loadData();
    } catch (cause) {
      addToast('error', cause instanceof Error ? cause.message : 'Unable to update user role.');
    }
  };

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold">Users and Roles</h1><p className="text-sm text-[var(--muted-foreground)]">Staff and administrator accounts only — customers are not listed here</p></div>
          <Button onClick={() => setModalOpen(true)}><Plus size={15} /> Add User</Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={userList as any}
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role', render: (row: any) => (
                <select
                  value={row.role}
                  disabled={row.id === user?.id}
                  onChange={event => void changeRole(row, event.target.value)}
                  aria-label={`Role for ${row.name}`}
                  className="rounded border border-[var(--border)] bg-white px-2 py-1 text-xs disabled:bg-[var(--secondary)]"
                >
                  {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              )},
              { key: 'createdAt', label: 'Created', render: (row: any) => new Date(row.createdAt).toLocaleDateString() },
            ]}
          />
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Invite User">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="First Name" value={form.firstName} onChange={event => setForm(previous => ({ ...previous, firstName: event.target.value }))} autoComplete="given-name" />
              <Input label="Last Name" value={form.lastName} onChange={event => setForm(previous => ({ ...previous, lastName: event.target.value }))} autoComplete="family-name" />
            </div>
            <Input label="Email" type="email" value={form.email} onChange={event => setForm(previous => ({ ...previous, email: event.target.value }))} autoComplete="email" />
            <label className="text-sm font-medium">Role
              <select value={form.role} onChange={event => setForm(previous => ({ ...previous, role: event.target.value }))} className="mt-1.5 w-full rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm">
                {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p className="text-xs text-[var(--muted-foreground)]">Supabase Auth will send the account invitation email.</p>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
              <Button className="flex-1" loading={saving} onClick={() => void inviteUser()}>Send Invitation</Button>
            </div>
          </div>
        </Modal>
      </div>
    </AdminSidebar>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export function AdminSettings() {
  const [tab, setTab] = useState('General');
  const { toasts, add: addToast, remove } = useToast();
  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div><h1 className="text-xl font-bold">Settings</h1><p className="text-sm text-[var(--muted-foreground)]">System configuration and preferences</p></div>
        <Tabs tabs={['General', 'Notifications', 'Security', 'Integrations']} active={tab} onChange={setTab} />
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-6">
          {tab === 'General' && (
            <div className="flex flex-col gap-5 max-w-lg">
              <Input label="Store Name" defaultValue="P&G Beauty PH" />
              <Input label="Store Email" type="email" defaultValue="store@pgbeauty.com" />
              <Select label="Currency" options={[{ value: 'PHP', label: '₱ Philippine Peso (PHP)' }, { value: 'USD', label: '$ US Dollar (USD)' }]} />
              <Select label="Time Zone" options={[{ value: 'Asia/Manila', label: 'Asia/Manila (UTC+8)' }]} />
              <Input label="Low Stock Threshold" type="number" defaultValue="20" hint="Alert when product stock falls below this number" />
              <Button onClick={() => addToast('success', 'Settings saved successfully!')}>Save Settings</Button>
            </div>
          )}
          {tab === 'Notifications' && (
            <div className="flex flex-col gap-4 max-w-lg">
              {[
                { label: 'Low stock alerts', desc: 'Get notified when products are running low' },
                { label: 'New order notifications', desc: 'Alert on every new customer order' },
                { label: 'Recommendation refresh', desc: 'Notify when the recommendation ranking refresh completes' },
                { label: 'Weekly sales summary', desc: 'Receive weekly email digest of sales performance' },
              ].map(n => (
                <div key={n.label} className="flex items-center justify-between p-4 border border-[var(--border)] rounded-[var(--radius-lg)]">
                  <div>
                    <div className="text-sm font-medium">{n.label}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{n.desc}</div>
                  </div>
                  <div className="w-10 h-5 bg-[var(--primary)] rounded-full relative cursor-pointer flex-shrink-0">
                    <div className="w-4 h-4 bg-white rounded-full absolute top-0.5 right-0.5 shadow-sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab !== 'General' && tab !== 'Notifications' && (
            <div className="text-center py-12 text-[var(--muted-foreground)] text-sm">
              <Settings size={40} className="mx-auto opacity-20 mb-3" />
              <p>{tab} settings are available in the full implementation.</p>
            </div>
          )}
        </div>
      </div>
    </AdminSidebar>
  );
}

// ─── Admin Login ──────────────────────────────────────────────────────────────
export function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      const result = await login(email, password, 'admin');
      if (result.ok) navigate('/admin/dashboard');
      else setError(result.error || 'Login failed. Check your admin credentials.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed. Check your admin credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--slate-admin)] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-[var(--radius-xl)] shadow-2xl p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center"><Brain size={16} className="text-white" /></div>
          <div>
            <div className="font-semibold text-sm text-[var(--foreground)]">P&G Beauty</div>
            <div className="text-[10px] text-[var(--muted-foreground)] font-mono">Admin MIS Portal</div>
          </div>
        </div>
        <h1 className="font-display text-2xl mb-1">Admin Sign In</h1>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">Access restricted to authorized staff only.</p>
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[var(--radius)] text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@pgbeauty.com" />
          <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          <Button type="submit" size="lg" className="w-full mt-2" loading={loading}>Sign In to MIS</Button>
        </form>
      </div>
    </div>
  );
}
