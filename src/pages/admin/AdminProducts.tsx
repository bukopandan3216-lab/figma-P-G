import { useEffect, useRef, useState } from 'react';
import { Plus, Edit2, Trash2, RotateCcw, Tag, Eye, X, ImagePlus } from 'lucide-react';
import { useCatalog } from '../../context/CatalogContext';
import type { Product } from '../../data/products';
import { supabase } from '../../lib/supabase';
import { Button, Badge, DataTable, Modal, Input, Select, useToast, ToastContainer, LoadingState, useTableMetrics } from '../../components/ui';
import AdminSidebar from '../../components/AdminSidebar';
import { safeImage } from '../../lib/image';
import { getProductImageStoragePath, removeProductImages, uploadProductImages, uploadVariantImages, PRODUCT_IMAGE_LIMIT, VARIANT_IMAGE_LIMIT } from '../../lib/productImages';
import { supplierCostFromListing } from '../../lib/catalog';
import { expiryStatus, expiryBadgeVariant, formatExpiryDate } from '../../lib/expiry';

type ProductStatus = 'Active' | 'Archived' | 'Draft';

interface AdminProduct {
  id: string;
  image: string;
  images: string[];
  thumbnail: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  tags: string[];
  price: number;
  stock: number;
  status: ProductStatus;
  salePrice?: number | null;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountStart?: string | null;
  discountEnd?: string | null;
  supplier?: string;
  variantName?: string;
}

const toAdminProduct = (p: Product): AdminProduct => {
  const productImages = p.images?.length ? p.images : p.image ? [p.image] : [];
  const variantImage = Object.values(p.variantImages || {})
    .flat()
    .find(url => typeof url === 'string' && url.trim() !== '');
  return {
    id: p.id, image: p.image, images: productImages, thumbnail: productImages[0] || variantImage || '',
    name: p.name, brand: p.brand, category: p.category, description: p.description || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    price: p.originalPrice ?? p.price,
    stock: p.stock, status: p.status || (p.inStock ? 'Active' : 'Archived'),
    salePrice: p.salePrice ?? null,
    discountType: p.discountType ?? null,
    discountValue: p.discountValue ?? null,
    discountStart: p.discountStart ?? null,
    discountEnd: p.discountEnd ?? null,
    supplier: p.supplier || '—',
    variantName: p.variantName || '—',
  };
};

const CATEGORIES = ['Skin Care', 'Hair Care', 'Body Care', 'Personal Care'];
const MAX_PRODUCT_IMAGES = 8;

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

// timestamptz -> value for <input type="datetime-local"> (browser-local time)
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// <input type="datetime-local"> -> ISO-8601 for timestamptz columns
const toIso = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

interface VariantInput {
  variantId?: string;
  name: string;
  price: string;
  stock: string;
  // Required per-variant expiry (YYYY-MM-DD). Every SKU must carry a shelf life.
  expiryDate: string;
  // Variant photos: URLs already stored on the row, the files picked in this
  // session (uploaded after the variant has an id) and their blob previews.
  images: string[];
  newFiles: File[];
  previews: string[];
}

const emptyVariantInput = (): VariantInput => ({ name: '', price: '', stock: '', expiryDate: '', images: [], newFiles: [], previews: [] });

// A row the user is halfway through (any field touched) must still block the
// save; a row with nothing typed at all is the auto-added spare and is ignored.
const isBlankVariantInput = (vi: VariantInput) => !vi.name.trim() && !vi.price && !vi.stock;

const isCompleteVariantInput = (vi: VariantInput) =>
  Boolean(vi.name.trim())
  && vi.price !== '' && Number.isFinite(Number(vi.price)) && Number(vi.price) >= 0
  && vi.stock !== '' && Number.isInteger(Number(vi.stock)) && Number(vi.stock) >= 0;

// Row shape returned by the Variants view modal
// (product_variants + its inventory row).
interface VariantRow {
  variant_id: string;
  size: string | null;
  sku: string | null;
  additional_price: number | null;
  expiry_date?: string | null;
  images?: string[] | null;
  inventory?: { stock_quantity: number } | { stock_quantity: number }[] | null;
}

const rowStock = (row: VariantRow) => {
  const inventory = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory;
  return Number(inventory?.stock_quantity || 0);
};

interface Brand {
  id: string;
  name: string;
  supplier_id: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

export default function AdminProducts() {
  const { products, loading, error, refresh } = useCatalog();
  const [productList, setProductList] = useState<AdminProduct[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [permanentDeleteId, setPermanentDeleteId] = useState<string | null>(null);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountForm, setDiscountForm] = useState({ discountType: 'percentage' as 'percentage' | 'fixed' | '', discountValue: '', discountStart: '', discountEnd: '' });
  const [showArchived, setShowArchived] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [uploadedPreviews, setUploadedPreviews] = useState<string[]>([]);
  // Current product photos the user marked for removal in the edit modal.
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierByProduct, setSupplierByProduct] = useState<Record<string, string>>({});
  const [brands, setBrands] = useState<Brand[]>([]);
  const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
  const [variantInputs, setVariantInputs] = useState<VariantInput[]>([emptyVariantInput()]);
  // Variant ids loaded when the edit modal opens, so save() can add, update and
  // remove variant rows (removed rows that history references will error out).
  const [editVariantIds, setEditVariantIds] = useState<string[]>([]);
  // Stored variant photo URLs marked for deletion (removed image or removed
  // variant row). Deleted from storage only after the save succeeds.
  const [variantImageCleanup, setVariantImageCleanup] = useState<string[]>([]);
  // variantId -> image URLs as they were when the edit modal opened, so save()
  // knows whether a row's gallery actually changed.
  const originalVariantImages = useRef<Record<string, string[]>>({});
  const [variantsFor, setVariantsFor] = useState<AdminProduct | null>(null);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [form, setForm] = useState({
    name: '',
    brand: '',
    category: CATEGORIES[0],
    description: '',
    tags: [] as string[],
    status: 'Active' as ProductStatus,
    discountType: 'percentage' as 'percentage' | 'fixed' | '',
    discountValue: '',
    discountStart: '',
    discountEnd: '',
    supplierId: '',
  });
  const { toasts, add: addToast, remove } = useToast();
  const { headRef: varHeadRef, bodyRef: varBodyRef, headH: varHead, rowH: varRow } = useTableMetrics(variantRows.length);
  const variantsWindowMin = varHead + varRow * 3;
  const variantsWindowMax = varHead + varRow * 6;

  useEffect(() => {
    setProductList(products.map(product => toAdminProduct({ ...product, supplier: supplierByProduct[product.id] ?? product.supplier })));
  }, [products, supplierByProduct]);

  useEffect(() => {
    void fetchSuppliers();
    void fetchBrands();
    void fetchSupplierByProduct();
  }, []);

  // Supplier names come from the owning brand, never a junction table.
  const fetchSupplierByProduct = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('id:product_id, brands(suppliers(name))');
    if (error || !data?.length) return;
    const map: Record<string, string> = {};
    for (const row of data as unknown as { id: string; brands?: { suppliers?: { name: string } | null } | null }[]) {
      const name = row.brands?.suppliers?.name;
      if (name) map[row.id] = name;
    }
    setSupplierByProduct(map);
  };

  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id:supplier_id, name')
      .eq('status', 'Active')
      .order('name');
    if (error) return;
    setSuppliers((data || []).map(s => ({ id: s.id, name: s.name })));
  };

  const fetchBrands = async () => {
    const { data, error } = await supabase
      .from('brands')
      .select('id:brand_id, name, supplier_id')
      .order('name');
    if (error) return;
    setBrands((data || []).map(b => ({ id: b.id, name: b.name, supplier_id: b.supplier_id ?? null })));
    setFilteredBrands((data || []).map(b => ({ id: b.id, name: b.name, supplier_id: b.supplier_id ?? null })));
  };

  const handleSupplierChange = (value: string) => {
    setForm(prev => ({ ...prev, supplierId: value, brand: '' }));
    if (value) {
      const filtered = brands.filter(b => b.supplier_id === value);
      setFilteredBrands(filtered);
    } else {
      setFilteredBrands(brands);
    }
  };

  const handleBrandChange = (value: string) => {
    setForm(prev => ({ ...prev, brand: value }));
    // The brand <select> posts the brand NAME (save() looks brands up by name).
    const brand = brands.find(b => b.name === value);
    const supplierId = brand?.supplier_id;
    if (supplierId) {
      setForm(prev => ({ ...prev, supplierId }));
      setFilteredBrands(brands.filter(b => b.supplier_id === supplierId));
    }
  };

  const clearUploads = () => {
    setUploadedPreviews(previous => { previous.forEach(url => URL.revokeObjectURL(url)); return []; });
    setUploadedImages([]);
    setRemovedImages([]);
    variantInputs.forEach(row => row.previews.forEach(url => URL.revokeObjectURL(url)));
    setVariantImageCleanup([]);
    originalVariantImages.current = {};
  };

  const toggleRemovedImage = (url: string) => {
    setRemovedImages(previous => previous.includes(url)
      ? previous.filter(item => item !== url)
      : [...previous, url]);
  };

  // Picking files appends to the queue so several selections can build one
  // gallery; duplicates are dropped and the queue stops at MAX_PRODUCT_IMAGES.
  const handleFileSelection = (files: FileList | null) => {
    const incoming = Array.from(files || []);
    const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
    const seen = new Set(uploadedImages.map(fileKey));
    const added: File[] = [];
    for (const file of incoming) {
      if (uploadedImages.length + added.length >= MAX_PRODUCT_IMAGES) break;
      const id = fileKey(file);
      if (seen.has(id)) continue;
      seen.add(id);
      added.push(file);
    }
    const skipped = incoming.length - added.length;
    if (skipped > 0) {
      addToast('error', added.length
        ? `A product can hold up to ${MAX_PRODUCT_IMAGES} images — ${skipped} selected file${skipped === 1 ? ' was' : 's were'} not added.`
        : `A product can hold up to ${MAX_PRODUCT_IMAGES} images.`);
    }
    if (!added.length) return;
    setUploadedImages(previous => [...previous, ...added]);
    setUploadedPreviews(previous => [...previous, ...added.map(file => URL.createObjectURL(file))]);
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages(previous => previous.filter((_, i) => i !== index));
    setUploadedPreviews(previous => {
      if (index < 0 || index >= previous.length) return previous;
      URL.revokeObjectURL(previous[index]);
      return previous.filter((_, i) => i !== index);
    });
  };

  const addTagValues = (value: string) => {
    const values = value.split(',');
    if (!values.some(item => item.trim())) return;
    setForm(previous => ({ ...previous, tags: normalizeTags([...previous.tags, ...values]) }));
    setTagDraft('');
  };

  const commitTagDraft = () => {
    if (tagDraft.trim()) addTagValues(tagDraft);
  };

  const removeTag = (tag: string) => {
    setForm(previous => ({ ...previous, tags: previous.tags.filter(existing => existing !== tag) }));
  };

  const openAdd = () => {
    setEditId(null);
    clearUploads();
    setForm({
      name: '', brand: '', category: CATEGORIES[0], description: '', tags: [], status: 'Active',
      discountType: 'percentage', discountValue: '', discountStart: '', discountEnd: '',
      supplierId: '',
    });
    setTagDraft('');
    setVariantInputs([emptyVariantInput()]);
    setEditVariantIds([]);
    setFilteredBrands(brands);
    setModalOpen(true);
  };

  const openEdit = async (p: AdminProduct) => {
    setEditId(p.id);
    clearUploads();
    const brand = brands.find(b => b.name === p.brand);
    const supplierId = brand?.supplier_id ?? '';
    setForm({
      name: p.name, brand: p.brand, category: p.category, description: p.description || '',
      tags: normalizeTags(p.tags || []), status: p.status, discountType: p.discountType || 'percentage',
      discountValue: String(p.discountValue || ''), discountStart: toLocalInput(p.discountStart),
      discountEnd: toLocalInput(p.discountEnd), supplierId,
    });
    setTagDraft('');
    setFilteredBrands(brand ? brands.filter(b => b.supplier_id === brand.supplier_id) : brands);

    // Variants carry the price and the stock, so the edit form edits them:
    // price shown = product base price + the variant's additional_price.
    const { data, error } = await supabase
      .from('product_variants')
      .select('variant_id, size, additional_price, sku, images, expiry_date, inventory(stock_quantity)')
      .eq('product_id', p.id)
      .order('size', { ascending: true });
    if (error) {
      addToast('error', `Unable to load this product's variants: ${error.message}`);
      setVariantInputs([emptyVariantInput()]);
      setEditVariantIds([]);
    } else {
      const rows = (data || []) as unknown as VariantRow[];
      const validImages = (images?: string[] | null) => (images || [])
        .filter((url): url is string => typeof url === 'string' && url.trim() !== '');
      originalVariantImages.current = Object.fromEntries(rows.map(row => [row.variant_id, validImages(row.images)]));
      setVariantImageCleanup([]);
      const loaded = rows.map(row => ({
        variantId: row.variant_id,
        name: row.size || '',
        price: String(p.price + Number(row.additional_price || 0)),
        stock: String(rowStock(row)),
        expiryDate: row.expiry_date ? row.expiry_date.slice(0, 10) : '',
        images: validImages(row.images),
        newFiles: [],
        previews: [],
      }));
      setEditVariantIds(rows.map(row => row.variant_id));
      setVariantInputs(loaded.length ? loaded : [emptyVariantInput()]);
    }
    setModalOpen(true);
  };

  const openVariants = async (p: AdminProduct) => {
    setVariantsFor(p);
    setVariantRows([]);
    setVariantsError('');
    setVariantsLoading(true);
    const { data, error } = await supabase
      .from('product_variants')
      .select('variant_id, size, sku, additional_price, images, expiry_date, inventory(stock_quantity)')
      .eq('product_id', p.id)
      .order('size', { ascending: true });
    setVariantsLoading(false);
    if (error) { setVariantsError(error.message); return; }
    setVariantRows((data || []) as unknown as VariantRow[]);
  };

  const openDiscount = (p: AdminProduct) => {
    setDiscountId(p.id);
    setDiscountForm({ discountType: p.discountType || 'percentage', discountValue: String(p.discountValue || ''), discountStart: toLocalInput(p.discountStart), discountEnd: toLocalInput(p.discountEnd) });
    setDiscountModalOpen(true);
  };

  const saveDiscount = async () => {
    if (!discountId) return;
    const discountValue = discountForm.discountValue ? Number(discountForm.discountValue) : null;
    if (!discountForm.discountType || discountValue === null || !discountForm.discountStart || !discountForm.discountEnd) {
      addToast('error', 'Please fill all discount fields.');
      return;
    }
    const product = productList.find(p => p.id === discountId);
    // AdminProduct.price is always the full (undiscounted) price, so a product
    // that is already on sale still gets the new discount off its real price.
    const basePrice = product?.price ?? 0;
    const salePrice = discountForm.discountType === 'percentage'
      ? Math.max(0, basePrice * (1 - discountValue / 100))
      : Math.max(0, basePrice - discountValue);

    const { error } = await supabase.from('products').update({
      original_price: basePrice,
      price: salePrice,
      sale_price: salePrice,
      discount_type: discountForm.discountType,
      discount_value: discountValue,
      discount_start: toIso(discountForm.discountStart),
      discount_end: toIso(discountForm.discountEnd),
    }).eq('product_id', discountId);

    if (error) { addToast('error', error.message); return; }
    addToast('success', 'Discount/sale updated.');
    setDiscountId(null);
    setDiscountModalOpen(false);
    await refresh();
  };

  const clearDiscount = async () => {
    if (!discountId) return;
    const product = productList.find(p => p.id === discountId);
    const basePrice = product?.price ?? 0;
    const { error } = await supabase.from('products').update({
      original_price: null,
      price: basePrice,
      sale_price: null,
      discount_type: null,
      discount_value: null,
      discount_start: null,
      discount_end: null,
    }).eq('product_id', discountId);
    if (error) { addToast('error', error.message); return; }
    addToast('success', 'Discount removed. Price restored to full.');
    setDiscountId(null);
    setDiscountModalOpen(false);
    await refresh();
  };

  // Edit mode: reconcile the form's variants with the rows in the database.
  // Variant price = product base price + additional_price; stock lives in inventory.
  const syncVariants = async (productId: string, basePrice: number, rows: VariantInput[]) => {
    const kept = rows.filter(vi => vi.variantId);
    const removedIds = editVariantIds.filter(id => !kept.some(vi => vi.variantId === id));

    for (const variantId of removedIds) {
      const { error } = await supabase.from('product_variants').delete().eq('variant_id', variantId);
      if (error) throw new Error(`Unable to remove a variant: ${error.message}. Variants already used in orders or stock movements cannot be deleted.`);
    }

    for (const vi of rows) {
      const additionalPrice = Number(vi.price) - basePrice;
      if (vi.variantId) {
        const { error } = await supabase.from('product_variants')
          .update({ size: vi.name, additional_price: additionalPrice, supplier_price: supplierCostFromListing(Number(vi.price)), expiry_date: vi.expiryDate || null })
          .eq('variant_id', vi.variantId);
        if (error) throw new Error(`Unable to update variant "${vi.name}": ${error.message}`);

        const { data: updated, error: stockError } = await supabase.from('inventory')
          .update({ stock_quantity: Number(vi.stock), updated_at: new Date().toISOString() })
          .eq('variant_id', vi.variantId)
          .select('inventory_id');
        if (stockError) throw new Error(`Unable to update stock for "${vi.name}": ${stockError.message}`);
        if (!updated?.length) {
          const { error: insertError } = await supabase.from('inventory')
            .insert({ variant_id: vi.variantId, stock_quantity: Number(vi.stock) });
          if (insertError) throw new Error(`Unable to set stock for "${vi.name}": ${insertError.message}`);
        }
      } else {
        const { data: variant, error } = await supabase.from('product_variants').insert({
          product_id: productId,
          sku: `${vi.name.toUpperCase().replace(/\s+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`,
          size: vi.name,
          additional_price: additionalPrice,
          supplier_price: supplierCostFromListing(Number(vi.price)),
          expiry_date: vi.expiryDate || null,
        }).select('id:variant_id').single();
        if (error) throw new Error(`Unable to add variant "${vi.name}": ${error.message}`);

        // Keep the new id on the row so its photos can be uploaded right after.
        vi.variantId = variant.id;

        const { error: inventoryError } = await supabase.from('inventory')
          .insert({ variant_id: variant.id, stock_quantity: Number(vi.stock) });
        if (inventoryError) throw new Error(`Unable to add stock for "${vi.name}": ${inventoryError.message}`);
      }
    }
  };

  // Upload the variant photos picked in the modal and write the merged gallery
  // back to product_variants.images. Runs after the variant rows exist, so new
  // variants have an id to store their files under. Rows whose gallery did not
  // change are skipped; a failing row removes only its own fresh uploads.
  const persistVariantImages = async (productId: string, rows: VariantInput[]) => {
    for (const vi of rows) {
      if (!vi.variantId) continue;
      const rowPaths: string[] = [];
      try {
        const uploaded = vi.newFiles.length
          ? await uploadVariantImages(productId, vi.variantId, vi.newFiles)
          : [];
        rowPaths.push(...uploaded.map(image => image.path));

        const stored = originalVariantImages.current[vi.variantId] ?? [];
        const merged = [...vi.images, ...uploaded.map(image => image.url)];
        const changed = uploaded.length > 0
          || merged.length !== stored.length
          || merged.some(url => !stored.includes(url));
        if (!changed) continue;

        const { error } = await supabase.from('product_variants')
          .update({ images: merged })
          .eq('variant_id', vi.variantId);
        if (error) throw new Error(`Unable to save photos for "${vi.name}": ${error.message}`);

        vi.images = merged;
        vi.newFiles = [];
        vi.previews.forEach(url => URL.revokeObjectURL(url));
        vi.previews = [];
        originalVariantImages.current[vi.variantId] = merged;
      } catch (error) {
        if (rowPaths.length) {
          try {
            await removeProductImages(rowPaths);
          } catch {
            // The original error matters more than the orphaned-file cleanup.
          }
        }
        throw error;
      }
    }
  };

  const save = async () => {
    if (!form.name.trim()) { addToast('error', 'Product name is required.'); return; }
    if (!form.supplierId) { addToast('error', 'Please select a supplier.'); return; }
    if (!form.brand) { addToast('error', 'Please select a brand.'); return; }

    // The trailing spare row the auto-append added is ignored; anything
    // half-filled still blocks the save so a variant is never dropped.
    const rows = variantInputs.filter(vi => !isBlankVariantInput(vi));
    if (!rows.length) { addToast('error', 'Add at least one variant.'); return; }

    // Validate all variant inputs — variants are the only place a price or a
    // stock quantity is entered.
    for (let i = 0; i < rows.length; i++) {
      const vi = rows[i];
      if (!vi.name.trim()) { addToast('error', `Variant ${i + 1}: Name is required.`); return; }
      if (!vi.price || !Number.isFinite(Number(vi.price)) || Number(vi.price) < 0) { addToast('error', `Variant ${i + 1}: Enter a valid price.`); return; }
      if (!vi.stock || !Number.isInteger(Number(vi.stock)) || Number(vi.stock) < 0) { addToast('error', `Variant ${i + 1}: Enter a whole-number stock quantity.`); return; }
      if (!vi.expiryDate || Number.isNaN(Date.parse(vi.expiryDate))) { addToast('error', `Variant ${i + 1}: Expiry date is required.`); return; }
    }

    // products.price is derived from the variants (cheapest variant) so the
    // storefront and the discount engine still have a base price to work with;
    // each variant keeps its own price as additional_price on top of it.
    const basePrice = Math.min(...rows.map(vi => Number(vi.price)));
    const tags = normalizeTags([...form.tags, tagDraft]);

    setSaving(true);
    let uploadedPaths: string[] = [];
    let productReferencesImages = false;
    let savedProductId: string | null = editId;
    try {
      if (editId) {
        const newImages = uploadedImages.length ? await uploadProductImages(editId, uploadedImages) : [];
        uploadedPaths = newImages.map(image => image.path);

        // Images are merged, not replaced: kept current photos stay, photos the
        // user removed from the modal are dropped, and new uploads are appended.
        const currentProduct = productList.find(product => product.id === editId);
        const existingUrls = [...new Set([currentProduct?.image, ...(currentProduct?.images || [])]
          .filter((image): image is string => Boolean(image)))];
        const mergedUrls = [...new Set([
          ...existingUrls.filter(url => !removedImages.includes(url)),
          ...newImages.map(image => image.url),
        ])];

        const update: { name: string; price: number; status: ProductStatus; description?: string; tags?: string[]; original_price?: number | null; image?: string; images?: string[]; sale_price?: number | null; discount_type?: 'percentage' | 'fixed' | null; discount_value?: number | null; discount_start?: string | null; discount_end?: string | null } = {
          name: form.name,
          price: basePrice,
          status: form.status,
          description: form.description,
          tags,
          original_price: null,
          sale_price: null,
          discount_type: null,
          discount_value: null,
          discount_start: null,
          discount_end: null,
        };
        const discountValue = form.discountValue ? Number(form.discountValue) : null;
        if (form.discountType && discountValue !== null && form.discountStart && form.discountEnd) {
          const salePrice = form.discountType === 'percentage'
            ? basePrice * (1 - discountValue / 100)
            : basePrice - discountValue;
          update.original_price = basePrice;
          update.price = Math.max(0, salePrice);
          update.sale_price = Math.max(0, salePrice);
          update.discount_type = form.discountType;
          update.discount_value = discountValue;
          update.discount_start = toIso(form.discountStart);
          update.discount_end = toIso(form.discountEnd);
        }
        if (mergedUrls.length) {
          update.image = mergedUrls[0];
          update.images = mergedUrls;
        } else {
          update.image = '';
          update.images = [];
        }

        const { error } = await supabase.from('products').update(update).eq('product_id', editId).select('id:product_id').single();
        if (error) throw error;
        productReferencesImages = true;

        const removedPaths = [...new Set(removedImages
          .map(getProductImageStoragePath)
          .filter((path): path is string => Boolean(path)))];
        if (removedPaths.length) {
          try {
            await removeProductImages(removedPaths);
          } catch (error) {
            addToast('error', `Product updated, but removed image cleanup failed: ${error instanceof Error ? error.message : 'Storage cleanup failed.'}`);
          }
        }

        // Variants carry price and stock: add new rows, update the loaded ones
        // and drop any variant the user removed from the form.
        await syncVariants(editId, basePrice, rows);

        setProductList(prev => prev.map(product => product.id === editId
          ? { ...product, name: form.name, price: basePrice, status: form.status, description: form.description, tags,
              image: mergedUrls[0] || '', images: mergedUrls, thumbnail: mergedUrls[0] || product.thumbnail }
          : product));
      } else {
        const { data: brand, error: brandError } = await supabase.from('brands').select('id:brand_id, supplier_id').eq('name', form.brand).single();
        if (brandError) throw new Error(`Unable to find brand "${form.brand}": ${brandError.message}`);

        const { data: category, error: categoryError } = await supabase.from('categories').select('id:category_id').eq('name', form.category).single();
        if (categoryError) throw new Error(`Unable to find category "${form.category}": ${categoryError.message}`);

        const productId = crypto.randomUUID();
        const images = uploadedImages.length ? await uploadProductImages(productId, uploadedImages) : [];
        uploadedPaths = images.map(image => image.path);
        const imageUrls = images.map(image => image.url);
        const discountValue = form.discountValue ? Number(form.discountValue) : null;
        let sale_price: number | null = null;
        let discount_type: 'percentage' | 'fixed' | null = null;
        let discount_value: number | null = null;
        let discount_start: string | null = null;
        let discount_end: string | null = null;
        if (form.discountType && discountValue !== null && form.discountStart && form.discountEnd) {
          sale_price = form.discountType === 'percentage'
            ? basePrice * (1 - discountValue / 100)
            : basePrice - discountValue;
          sale_price = Math.max(0, sale_price);
          discount_type = form.discountType;
          discount_value = discountValue;
          discount_start = toIso(form.discountStart);
          discount_end = toIso(form.discountEnd);
        }
        const { data: product, error } = await supabase.from('products').insert({
          product_id: productId,
          name: form.name,
          brand_id: brand.id,
          category_id: category.id,
          price: sale_price ?? basePrice,
          original_price: sale_price != null ? basePrice : null,
          sale_price,
          discount_type,
          discount_value,
          discount_start,
          discount_end,
          image: imageUrls[0] || '',
          images: imageUrls,
          description: form.description,
          tags,
          status: form.status,
        }).select('id:product_id').single();

        if (error) throw error;
        if (!product) throw new Error('Product was not returned after saving.');
        productReferencesImages = true;
        savedProductId = product.id;

        // Create variants and inventory rows for each variant. The variant price
        // is stored as additional_price on top of the product base price, so
        // every variant keeps the price typed in the form.
        for (let i = 0; i < rows.length; i++) {
          const vi = rows[i];
          const { data: variant, error: variantError } = await supabase.from('product_variants').insert({
            product_id: product.id,
            sku: `${vi.name.toUpperCase().replace(/\s+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`,
            size: vi.name,
            additional_price: Number(vi.price) - basePrice,
            supplier_price: supplierCostFromListing(Number(vi.price)),
            expiry_date: vi.expiryDate || null,
          }).select('id:variant_id').single();
          if (variantError) throw new Error(variantError.message);
          if (!variant) throw new Error(`Variant ${i + 1} was not returned after saving.`);

          // Keep the new id on the row so its photos can be uploaded right after.
          vi.variantId = variant.id;

          const { error: inventoryError } = await supabase.from('inventory').insert({ variant_id: variant.id, stock_quantity: Number(vi.stock) });
          if (inventoryError) throw new Error(inventoryError.message);
        }

      }

      // Variant photos need the variant ids, so they are uploaded after the
      // rows exist; the stored photos the user dropped are deleted only once
      // the product itself saved cleanly.
      await persistVariantImages(savedProductId ?? '', rows);
      const variantCleanupPaths = [...new Set(variantImageCleanup
        .map(getProductImageStoragePath)
        .filter((path): path is string => Boolean(path)))];
      if (variantCleanupPaths.length) {
        try {
          await removeProductImages(variantCleanupPaths);
        } catch (error) {
          addToast('error', `Saved, but some removed variant photos could not be deleted: ${error instanceof Error ? error.message : 'Storage cleanup failed.'}`);
        }
      }

      addToast('success', editId ? 'Product updated successfully!' : 'Product added successfully!');
      await refresh();
      setModalOpen(false);
      clearUploads();
    } catch (error) {
      if (uploadedPaths.length && !productReferencesImages) {
        try {
          await removeProductImages(uploadedPaths);
        } catch (cleanupError) {
          addToast('error', `Unable to clean up uploaded product images: ${cleanupError instanceof Error ? cleanupError.message : 'Storage cleanup failed.'}`);
        }
      }
      addToast('error', error instanceof Error ? error.message : 'Unable to upload product images.');
    } finally {
      setSaving(false);
    }
  };

  const archiveProduct = async () => {
    if (!archiveId) return;
    const { error: archiveError } = await supabase.from('products').update({ status: 'Archived' }).eq('product_id', archiveId);
    if (archiveError) { addToast('error', archiveError.message); return; }
    addToast('info', 'Product moved to Archived Products.');
    setArchiveId(null);
    await refresh();
  };

  const restoreProduct = async (product: AdminProduct) => {
    const { error: restoreError } = await supabase.from('products').update({ status: 'Active' }).eq('product_id', product.id);
    if (restoreError) { addToast('error', restoreError.message); return; }
    addToast('success', `${product.name} restored.`);
    await refresh();
  };

  const permanentlyDeleteProduct = async () => {
    if (!permanentDeleteId) return;
    const archivedProduct = productList.find(product => product.id === permanentDeleteId);
    const { data: variantRows, error: variantError } = await supabase
      .from('product_variants')
      .select('images')
      .eq('product_id', permanentDeleteId);
    if (variantError) {
      addToast('error', `Unable to load variant photos before deletion: ${variantError.message}`);
      return;
    }
    const variantImages = ((variantRows || []) as { images?: string[] | null }[])
      .flatMap(row => row.images || []);
    const imagePaths = [...new Set([archivedProduct?.image, ...(archivedProduct?.images || []), ...variantImages]
      .filter((image): image is string => Boolean(image))
      .map(getProductImageStoragePath)
      .filter((path): path is string => Boolean(path)))];
    const { error: deleteError } = await supabase.from('products').delete().eq('product_id', permanentDeleteId);
    if (deleteError) { addToast('error', deleteError.message); return; }
    try {
      await removeProductImages(imagePaths);
    } catch (error) {
      addToast('error', `Product deleted, but image cleanup failed: ${error instanceof Error ? error.message : 'Storage cleanup failed.'}`);
    }
    addToast('info', 'Product permanently deleted.');
    setPermanentDeleteId(null);
    await refresh();
  };

  const set = (k: string, formType: 'main' | 'discount' = 'main') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (formType === 'discount') {
      setDiscountForm(p => ({ ...p, [k]: e.target.value }));
    } else {
      setForm(p => ({ ...p, [k]: e.target.value }));
    }
  };

  // The variant count is derived from the rows themselves: finishing the last
  // row opens a fresh one (same behaviour as Create Purchase Order), and a
  // half-typed row never appends twice.
  const updateVariantInput = (index: number, field: 'name' | 'price' | 'stock' | 'expiryDate', value: string) => {
    setVariantInputs(prev => {
      const next = prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row));
      const wasComplete = isCompleteVariantInput(prev[index]);
      const isLastRow = index === next.length - 1;
      if (isLastRow && !wasComplete && isCompleteVariantInput(next[index])) next.push(emptyVariantInput());
      return next;
    });
  };

  const addVariantInput = () => setVariantInputs(prev => [...prev, emptyVariantInput()]);

  const removeVariantInput = (index: number) => {
    const row = variantInputs[index];
    if (!row || variantInputs.length <= 1) return;
    row.previews.forEach(url => URL.revokeObjectURL(url));
    if (row.images.length) setVariantImageCleanup(prev => [...prev, ...row.images]);
    setVariantInputs(prev => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const addVariantFiles = (index: number, files: FileList | null) => {
    const row = variantInputs[index];
    const incoming = Array.from(files || []);
    if (!row || !incoming.length) return;

    const fileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
    const seen = new Set(row.newFiles.map(fileKey));
    const added: File[] = [];
    for (const file of incoming) {
      if (row.images.length + row.newFiles.length + added.length >= VARIANT_IMAGE_LIMIT) break;
      const id = fileKey(file);
      if (seen.has(id)) continue;
      seen.add(id);
      added.push(file);
    }
    if (added.length < incoming.length) {
      addToast('error', `A variant can hold up to ${VARIANT_IMAGE_LIMIT} photos.`);
    }
    if (!added.length) return;
    setVariantInputs(prev => prev.map((existing, rowIndex) => (rowIndex === index
      ? { ...existing, newFiles: [...existing.newFiles, ...added], previews: [...existing.previews, ...added.map(file => URL.createObjectURL(file))] }
      : existing)));
  };

  const removeVariantStoredImage = (index: number, url: string) => {
    setVariantInputs(prev => prev.map((row, rowIndex) => (rowIndex === index
      ? { ...row, images: row.images.filter(image => image !== url) }
      : row)));
    setVariantImageCleanup(prev => [...prev, url]);
  };

  const removeVariantNewFile = (index: number, fileIndex: number) => {
    setVariantInputs(prev => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const preview = row.previews[fileIndex];
      if (preview) URL.revokeObjectURL(preview);
      return {
        ...row,
        newFiles: row.newFiles.filter((_, newIndex) => newIndex !== fileIndex),
        previews: row.previews.filter((_, previewIndex) => previewIndex !== fileIndex),
      };
    }));
  };

  const variantCount = variantInputs.filter(vi => !isBlankVariantInput(vi)).length;

  return (
    <AdminSidebar>
      <ToastContainer toasts={toasts} onRemove={remove} />
      <div className="flex flex-col gap-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{showArchived ? 'Archived Products' : 'Products'}</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {showArchived
                ? `${productList.filter(product => product.status === 'Archived').length} archived products`
                : `${productList.filter(product => product.status !== 'Archived').length} total products`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showArchived ? (
              <Button variant="outline" onClick={() => setShowArchived(false)}>Back to Products</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setShowArchived(true); void refresh(); }}>Archived ({productList.filter(product => product.status === 'Archived').length})</Button>
                <Button onClick={openAdd}><Plus size={15} /> Add Product</Button>
              </>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius-xl)] p-5">
          <DataTable
            data={productList.filter(product => showArchived ? product.status === 'Archived' : product.status !== 'Archived') as any}
            emptyMessage={loading ? <LoadingState message="Hang tight, loading products…" /> : 'No products found.'}
            columns={[
              { key: 'image', label: '', sortable: false, render: (row: any) => <img src={safeImage(row.thumbnail, row.name)} alt="" className="w-10 h-10 object-cover rounded-[var(--radius)] bg-[var(--secondary)]" /> },
              { key: 'name', label: 'Product Name', render: (row: any) => <span className="font-medium text-sm">{row.name}</span> },
              { key: 'brand', label: 'Brand' },
              { key: 'category', label: 'Category' },
              { key: 'supplier', label: 'Supplier', render: (row: any) => <span className="text-xs text-[var(--muted-foreground)]">{row.supplier || '—'}</span> },
              { key: 'variant', label: 'Variants', render: (row: any) => (
                <button
                  onClick={() => void openVariants(row as AdminProduct)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  aria-label={`View variants of ${row.name}`}
                >
                  <Eye size={13} /> View
                </button>
              )},
              { key: 'status', label: 'Status', render: (row: any) => (
                <Badge variant={row.status === 'Active' ? 'success' : row.status === 'Draft' ? 'warning' : 'muted'}>{row.status}</Badge>
              )},
              { key: 'actions', label: '', sortable: false, render: (row: any) => (
                <div className="flex gap-1">
                  {showArchived ? (
                    <>
                      <button onClick={() => void restoreProduct(row as AdminProduct)} className="p-1.5 hover:bg-emerald-50 rounded transition-colors text-[var(--muted-foreground)] hover:text-emerald-600" title="Restore" aria-label={`Restore ${row.name}`}><RotateCcw size={14} /></button>
                      <button onClick={() => setPermanentDeleteId(row.id)} className="p-1.5 hover:bg-red-50 rounded transition-colors text-[var(--muted-foreground)] hover:text-red-500" title="Delete permanently" aria-label={`Delete ${row.name} permanently`}><Trash2 size={14} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openEdit(row as AdminProduct)} className="p-1.5 hover:bg-[var(--secondary)] rounded transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="Edit"><Edit2 size={14} /></button>
                      <button onClick={() => openDiscount(row as AdminProduct)} className="p-1.5 hover:bg-amber-50 rounded transition-colors text-[var(--muted-foreground)] hover:text-amber-600" title="Set Discount / Sale" aria-label={`Set discount for ${row.name}`}><Tag size={14} /></button>
                      <button onClick={() => setArchiveId(row.id)} className="p-1.5 hover:bg-red-50 rounded transition-colors text-[var(--muted-foreground)] hover:text-red-500" title="Archive" aria-label={`Archive ${row.name}`}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              )},
            ]}
          />
        </div>

        {/* Add/Edit Modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Product' : 'Add Product'} size="lg">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Product Name *" value={form.name} onChange={set('name')} placeholder="e.g. Regenerist Cream" className="col-span-2" />
            <Select label="Supplier *" value={form.supplierId} onChange={event => handleSupplierChange(event.target.value)} options={suppliers.map(s => ({ value: s.id, label: s.name }))} />
            <Select label="Brand *" value={form.brand} onChange={event => handleBrandChange(event.target.value)} options={filteredBrands.map(b => ({ value: b.name, label: b.name }))} />
            <Select label="Category" value={form.category} onChange={event => setForm(prev => ({ ...prev, category: event.target.value }))} options={CATEGORIES.map(c => ({ value: c, label: c }))} />
            <div className="col-span-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-sm font-medium">
                  Variant Details{' '}
                  <span className="font-normal text-[var(--muted-foreground)]">— {variantCount} variant{variantCount === 1 ? '' : 's'} added</span>
                </label>
                <Button size="sm" variant="outline" onClick={addVariantInput}><Plus size={13} /> Add variant</Button>
              </div>
              <div className="space-y-3">
                {variantInputs.map((vi, i) => (
                  <div key={i} className="rounded border border-[var(--border)] bg-[var(--secondary)]/30 p-3">
                    <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_28px] gap-3">
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1">Variant {i + 1} Name</label>
                      <input
                        type="text"
                        value={vi.name}
                        onChange={(e) => updateVariantInput(i, 'name', e.target.value)}
                        placeholder="e.g. 100ml"
                        className="w-full rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1">Price (₱) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={vi.price}
                        onChange={(e) => updateVariantInput(i, 'price', e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1">Stock *</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={vi.stock}
                        onChange={(e) => updateVariantInput(i, 'stock', e.target.value)}
                        placeholder="0"
                        className="w-full rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1">Expiry Date</label>
                      <input
                        type="date"
                        value={vi.expiryDate}
                        onChange={(e) => updateVariantInput(i, 'expiryDate', e.target.value)}
                        title="Required. Dates within 60 days are Near Expiry; today or earlier is Expired — both are hidden from customers."
                        className="w-full rounded border border-[var(--border)] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                      {vi.expiryDate && (
                        <span className="mt-1">
                          <Badge variant={expiryBadgeVariant(expiryStatus(vi.expiryDate))}>{expiryStatus(vi.expiryDate)}</Badge>
                        </span>
                      )}
                    </div>
                    <div className="flex items-end justify-end pb-0.5">
                      <button
                        type="button"
                        onClick={() => removeVariantInput(i)}
                        disabled={variantInputs.length <= 1}
                        title={`Remove variant ${i + 1}`}
                        aria-label={`Remove variant ${i + 1}`}
                        className="p-1.5 rounded text-[var(--muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
                      <span className="text-[10px] uppercase text-[var(--muted-foreground)]">
                        Variant photos {vi.images.length + vi.newFiles.length}/{VARIANT_IMAGE_LIMIT}
                      </span>
                      {vi.images.length + vi.newFiles.length === 0 && (
                        <span className="text-[10px] text-[var(--muted-foreground)]">No variant photos yet.</span>
                      )}
                      {vi.images.map(url => (
                        <div key={url} className="relative">
                          <img src={url} alt="" className="h-10 w-10 rounded border border-[var(--border)] object-cover" />
                          <button
                            type="button"
                            onClick={() => removeVariantStoredImage(i, url)}
                            title="Remove photo"
                            aria-label={`Remove a photo from variant ${i + 1}`}
                            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:text-red-500"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {vi.previews.map((url, fileIndex) => (
                        <div key={url} className="relative">
                          <img src={url} alt="" className="h-10 w-10 rounded border border-dashed border-[var(--border)] object-cover" />
                          <button
                            type="button"
                            onClick={() => removeVariantNewFile(i, fileIndex)}
                            title="Remove photo"
                            aria-label={`Remove a new photo from variant ${i + 1}`}
                            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:text-red-500"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {vi.images.length + vi.newFiles.length < VARIANT_IMAGE_LIMIT && (
                        <label
                          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded border border-dashed border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--ring)] hover:text-[var(--foreground)]"
                          title="Add photos"
                        >
                          <ImagePlus size={15} />
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            aria-label={`Add photos to variant ${i + 1}`}
                            onChange={event => { addVariantFiles(i, event.target.files); event.target.value = ''; }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">Price and stock are set per variant — filling in every field of the last row adds a new one. The product's base price is taken from its lowest-priced variant.</p>
            </div>
            <Select label="Status" value={form.status} onChange={set('status')} options={[{ value: 'Active', label: 'Active' }, { value: 'Archived', label: 'Archived' }, { value: 'Draft', label: 'Draft' }]} className="col-span-2" />
            <div className="col-span-2">
              <label className="text-sm font-medium block mb-1">Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] resize-none"
                placeholder="Product description…"
              />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium block mb-1">Tags</label>
              <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--ring)]">
                {form.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--foreground)]">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
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
                  value={tagDraft}
                  onChange={event => {
                    const value = event.target.value;
                    if (value.includes(',')) addTagValues(value);
                    else setTagDraft(value);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTagValues(tagDraft);
                    } else if (event.key === 'Backspace' && !tagDraft && form.tags.length) {
                      removeTag(form.tags[form.tags.length - 1]);
                    }
                  }}
                  onBlur={commitTagDraft}
                  placeholder={form.tags.length ? 'Add another tag…' : 'e.g. moisturizer, anti-aging'}
                  aria-label="Product tags"
                  className="min-w-[160px] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Press Enter or comma to add a tag. Tags power product search and recommendations.</p>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium block mb-2">Product Images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => { handleFileSelection(event.target.files); event.target.value = ''; }}
                className="block w-full text-sm text-[var(--muted-foreground)] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-[var(--secondary)] file:text-[var(--foreground)] file:font-medium hover:file:bg-[var(--muted)]"
              />
              {editId && (() => {
                const current = productList.find(product => product.id === editId);
                const existing = [...new Set([current?.image, ...(current?.images || [])]
                  .filter((image): image is string => Boolean(image)))];
                if (!existing.length) return null;
                return (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1.5">
                      Current images{removedImages.length ? ` (${existing.length - removedImages.length} kept, ${removedImages.length} marked for removal)` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {existing.map(url => {
                        const marked = removedImages.includes(url);
                        return (
                          <div key={url} className="relative">
                            <img
                              src={url}
                              alt=""
                              className={`h-14 w-14 rounded-md border object-cover transition-opacity ${marked ? 'border-red-300 opacity-40 line-through' : 'border-[var(--border)]'}`}
                            />
                            <button
                              type="button"
                              onClick={() => toggleRemovedImage(url)}
                              className={`absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border bg-[var(--card)] transition-colors ${marked ? 'border-red-300 text-red-500' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-red-500'}`}
                              aria-label={marked ? 'Keep this image' : 'Remove this image'}
                              title={marked ? 'Keep this image' : 'Remove this image'}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {uploadedPreviews.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1.5">New images ({uploadedPreviews.length}) — added to the product on save</p>
                  <div className="flex flex-wrap gap-2">
                    {uploadedPreviews.map((url, index) => (
                      <div key={`${uploadedImages[index]?.name || 'image'}-${index}`} className="relative">
                        <img src={url} alt={uploadedImages[index]?.name || `New image ${index + 1}`} className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
                        <button
                          type="button"
                          onClick={() => removeUploadedImage(index)}
                          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] transition-colors hover:text-red-500"
                          aria-label={`Remove ${uploadedImages[index]?.name || `image ${index + 1}`}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button>
            <Button className="flex-1" loading={saving} onClick={save}>{editId ? 'Save Changes' : 'Add Product'}</Button>
          </div>
        </Modal>

        {/* Variant viewer — Products table → View */}
        <Modal open={Boolean(variantsFor)} onClose={() => setVariantsFor(null)} title={`Variants — ${variantsFor?.name ?? ''}`} size="md">
          {variantsLoading ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">Loading variants…</p>
          ) : variantsError ? (
            <p className="py-4 text-sm text-red-500">{variantsError}</p>
          ) : variantRows.length === 0 ? (
            <p className="py-4 text-sm text-[var(--muted-foreground)]">This product has no variants yet.</p>
          ) : (
            <div className="overflow-x-auto overflow-y-auto" style={{ minHeight: variantsWindowMin, maxHeight: variantsWindowMax }}>
              <table className="w-full text-sm">
                <thead ref={varHeadRef}>
                  <tr className="text-left text-xs uppercase text-[var(--muted-foreground)]">
                    <th className="sticky top-0 z-10 bg-white border-b border-[var(--border)] py-2 pr-3">Variant</th>
                    <th className="sticky top-0 z-10 bg-white border-b border-[var(--border)] py-2 pr-3">SKU</th>
                    <th className="sticky top-0 z-10 bg-white border-b border-[var(--border)] py-2 pr-3 text-right">Price</th>
                    <th className="sticky top-0 z-10 bg-white border-b border-[var(--border)] py-2 pr-3">Expiry</th>
                    <th className="sticky top-0 z-10 bg-white border-b border-[var(--border)] py-2 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody ref={varBodyRef} className="whitespace-nowrap">
                  {variantRows.map(row => {
                    const price = (variantsFor?.price ?? 0) + Number(row.additional_price || 0);
                    const stock = rowStock(row);
                    return (
                      <tr key={row.variant_id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 pr-3 font-medium">
                          <div className="flex items-center gap-2">
                            {(row.images?.length ?? 0) > 0 && (
                              <div className="flex shrink-0 items-center gap-1">
                                {(row.images || []).slice(0, 3).map((url, imageIndex) => (
                                  <img key={url} src={url} alt="" title={`Photo ${imageIndex + 1}`} className="h-7 w-7 rounded border border-[var(--border)] object-cover" />
                                ))}
                                {(row.images?.length ?? 0) > 3 && (
                                  <span className="text-[10px] text-[var(--muted-foreground)]">+{(row.images?.length ?? 0) - 3}</span>
                                )}
                              </div>
                            )}
                            <span>{row.size || '—'}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-[var(--muted-foreground)]">{row.sku || '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">₱{price.toFixed(2)}</td>
                        <td className="py-2 pr-3">
                          {row.expiry_date ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs">{formatExpiryDate(row.expiry_date)}</span>
                              <Badge variant={expiryBadgeVariant(expiryStatus(row.expiry_date))}>{expiryStatus(row.expiry_date)}</Badge>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </td>
                        <td className={`py-2 text-right font-mono ${stock === 0 ? 'text-red-500' : stock < 10 ? 'text-amber-600' : 'text-[var(--foreground)]'}`}>{stock}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">Price and stock are shown per variant — totals are intentionally not summed.</p>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="outline" onClick={() => setVariantsFor(null)}>Close</Button>
          </div>
        </Modal>

        <Modal open={!!archiveId} onClose={() => setArchiveId(null)} title="Archive Product" size="sm">
          <p className="text-sm text-[var(--muted-foreground)] mb-6">This product will be hidden from the active product list. You can restore or permanently delete it from Archived Products.</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setArchiveId(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={archiveProduct} className="flex-1">Archive Product</Button>
          </div>
        </Modal>

        <Modal open={!!permanentDeleteId} onClose={() => setPermanentDeleteId(null)} title="Delete Product Permanently" size="sm">
          <p className="text-sm text-[var(--muted-foreground)] mb-6">This permanently deletes the product and cannot be undone. Products referenced by purchase or order history cannot be deleted.</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setPermanentDeleteId(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={permanentlyDeleteProduct} className="flex-1">Delete Permanently</Button>
          </div>
        </Modal>

        {/* Discount / Sale Modal */}
        <Modal open={discountModalOpen} onClose={() => setDiscountModalOpen(false)} title="Set Discount / Sale" size="md">
          <div className="grid grid-cols-2 gap-4">
            <Select label="Type" value={discountForm.discountType} onChange={set('discountType', 'discount')} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'fixed', label: 'Fixed ₱' }]} />
            <Input label="Value" type="number" value={discountForm.discountValue} onChange={set('discountValue', 'discount')} placeholder="e.g. 20 or 50.00" />
            <Input label="Starts At" type="datetime-local" value={discountForm.discountStart} onChange={set('discountStart', 'discount')} />
            <Input label="Ends At" type="datetime-local" value={discountForm.discountEnd} onChange={set('discountEnd', 'discount')} />
          </div>
          <div className="flex gap-3 mt-6">
            <Button variant="outline" onClick={() => setDiscountModalOpen(false)} className="flex-1">Cancel</Button>
            {productList.find(p => p.id === discountId)?.salePrice != null && (
              <Button variant="danger" onClick={() => void clearDiscount()}>Remove Discount</Button>
            )}
            <Button className="flex-1" onClick={saveDiscount}>Set Discount</Button>
          </div>
        </Modal>
      </div>
    </AdminSidebar>
  );
}