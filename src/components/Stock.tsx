import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import { pingDatabase } from '../utils/dbPing';
import { getApiBase } from '../utils/apiBase';
import {
  dateOnlyStringToLocalDate,
  dateOnlyToTime,
  formatDateOnlyForDisplay,
  localDateToDateOnlyString,
  normalizeDateOnlyString,
} from '../utils/dateOnly';
import './Stock.css';
import { StockFormDropdown } from './StockFormDropdown';

const API_BASE = getApiBase();

function scrollStockEntryFormIntoView(formEl: HTMLDivElement | null) {
  if (!formEl) return;
  const navOffset = window.innerWidth <= 768 ? 100 : 90;
  formEl.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  window.setTimeout(() => {
    const rect = formEl.getBoundingClientRect();
    if (rect.top < navOffset + 8) {
      window.scrollBy({ top: rect.top - navOffset - 8, behavior: 'smooth' });
    }
  }, 100);
}

type Nullable<T> = T | null | undefined;

interface StockRow {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  purchase_date: Nullable<string>;
  sale_date: Nullable<string>;
  sale_price: Nullable<string | number>;
  sold_platform: Nullable<string>;
  net_profit: Nullable<string | number>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
  brand_id: Nullable<number>;
  category_id: Nullable<number>;
  brand_tag_image_id: Nullable<number>;
  projected_sale_price: Nullable<string | number>;
  category_size_id: Nullable<number>;
  sourced_location?: Nullable<string>;
  /** Business write-off: item is unsellable (damaged, defective, etc.). */
  is_inventory_write_off?: Nullable<boolean>;
  /** Large / awkward-to-ship item (highlighted on Orders → Sales). */
  is_bulky_item?: Nullable<boolean>;
  /** eBay listing is still a draft (not live). */
  is_ebay_draft?: Nullable<boolean>;
}

type StockCreateFormState = {
  item_name: string;
  department_id: string;
  category_id: string;
  purchase_price: string;
  purchase_date: string;
  sale_date: string;
  sale_price: string;
  sold_platform: string;
  vinted_id: string;
  ebay_id: string;
  depop_id: string;
  brand_id: string;
  brand_tag_image_id: string;
  projected_sale_price: string;
  category_size_id: string;
  sourced_location: string;
  inventory_write_off: boolean;
  bulky_item: boolean;
  ebay_draft: boolean;
};

interface Brand {
  id: number;
  brand_name: string;
  department_id?: number | null;
  category_id?: number | null;
}

interface Department {
  id: number;
  department_name: string;
}

interface Category {
  id: number;
  category_name: string;
  department_id?: number;
  stock_count?: number;
}

interface BrandTagImageRow {
  id: number;
  brand_id: number;
  public_url?: string | null;
  caption?: string | null;
  image_kind?: string | null;
}

interface CategorySizeRow {
  id: number;
  category_id: number;
  size_label: string;
  sort_order?: number;
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
  total?: number;
  page?: number;
  limit?: number;
  total_pages?: number;
  edit_page?: number | null;
}

interface StockSummaryResponse {
  total_purchase: number;
  total_sales: number;
  total_profit: number;
}

const STOCK_PAGE_SIZE = 50;

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

// Removed unused CATEGORIES constant - now using categories from database

const PLATFORMS = ['Not Listed', 'Vinted', 'eBay'];

const SOURCED_LOCATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'charity_shop', label: 'Charity shop' },
  { value: 'bootsale', label: 'Bootsale' },
  { value: 'online_flip', label: 'Online flip' },
];

function sourcedLocationFromRow(row: { sourced_location?: Nullable<string> }): string {
  const v = row.sourced_location;
  if (v === 'charity_shop' || v === 'bootsale' || v === 'online_flip') return v;
  return 'charity_shop';
}

function stockRowWriteOffFromRow(row: { is_inventory_write_off?: unknown }): boolean {
  const v = row.is_inventory_write_off;
  return v === true || v === 't' || v === 'true' || v === 1 || v === '1';
}

function stockRowBulkyFromRow(row: { is_bulky_item?: unknown }): boolean {
  const v = row.is_bulky_item;
  return v === true || v === 't' || v === 'true' || v === 1 || v === '1';
}

function stockRowEbayDraftFromRow(row: { is_ebay_draft?: unknown }): boolean {
  const v = row.is_ebay_draft;
  return v === true || v === 't' || v === 'true' || v === 1 || v === '1';
}

function stockSaleDatePresent(row: { sale_date?: Nullable<string> }): boolean {
  const d = row.sale_date;
  return d != null && String(d).trim() !== '';
}

function stockSalePriceEmpty(row: { sale_price?: Nullable<string | number> }): boolean {
  const sp = row.sale_price;
  if (sp === null || sp === undefined) return true;
  if (typeof sp === 'string' && sp.trim() === '') return true;
  return false;
}

/** Sold column styling: red if sold date set but price missing; green if sold with price; else neutral. */
function soldColumnClass(row: StockRow): string {
  const hasDate = stockSaleDatePresent(row);
  const priceEmpty = stockSalePriceEmpty(row);
  if (hasDate && priceEmpty) return 'stock-sold-cell stock-sold-cell--no-price';
  if (hasDate && !priceEmpty) return 'stock-sold-cell stock-sold-cell--ok';
  return 'stock-sold-cell stock-sold-cell--neutral';
}

function departmentNameForRow(
  row: StockRow,
  categoriesList: Category[],
  departmentsList: Department[]
): string {
  const cat = categoriesList.find((c) => c.id === row.category_id);
  const depId = cat?.department_id;
  if (depId == null || !Number.isFinite(Number(depId)) || Number(depId) < 1) return '—';
  const dep = departmentsList.find((d) => d.id === Number(depId));
  const name = dep?.department_name?.trim();
  return name || '—';
}

const formatCurrency = (value: Nullable<string | number>) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) {
    return `${value}`;
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2
  }).format(parsed);
};

const formatDate = (value: Nullable<string>) => formatDateOnlyForDisplay(value ?? null);

function normalizeStockRowDates(row: StockRow): StockRow {
  const purchaseDate = normalizeDateOnlyString(row.purchase_date ?? '');
  const saleDate = normalizeDateOnlyString(row.sale_date ?? '');
  return {
    ...row,
    purchase_date: purchaseDate || null,
    sale_date: saleDate || null,
  };
}

/** Envelope — add item to orders (postage / dispatch). */
function AddToOrdersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m22 6-10 7L2 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Envelope + check — save, add to orders, and close. */
function SaveAddToOrderCloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 7.5 12 13l9-5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 5h14a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="17.5" r="4.25" fill="currentColor" opacity="0.92" />
      <path
        d="M15.75 17.5 16.85 18.65 19.35 16.1"
        stroke="#0f172a"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


function buildStockInstagramAskAiPrompt(input: {
  itemName: string;
  brandName: string;
  categoryName: string;
  sku: number | null;
}): string {
  const lines = [
    'You are helping write an Instagram post for a second-hand / resale fashion listing (UK).',
    '',
    'Use the following facts only — do not invent materials, defects, measurements, or authenticity details not clearly implied by the title.',
    '',
    `- Title: ${input.itemName}`,
    `- Brand: ${input.brandName}`,
    `- Category: ${input.categoryName}`,
  ];
  if (input.sku !== null) {
    lines.push(`- Internal SKU / stock ID: ${input.sku} (for your reference only — do not put this in the public caption.)`);
  }
  lines.push(
    '',
    'Posting context:',
    '- The post is **caption + hashtags only**. Do not instruct the user to upload marketplace listing screenshots or reuse Vinted/eBay listing images — that often violates Instagram policy. Keep everything suitable for a normal photo + caption (their own imagery) or a text-led post.',
    '',
    'Instagram / policy constraints:',
    '- Do NOT mention or include a link to this item on Vinted, eBay, Depop, or any other URL for this specific listing. No “swipe up” / DM-for-link gymnastics to a per-item page.',
    '- For anyone interested in **this** item, the caption must **only** direct them to your shop in general — e.g. that **the link to your store is in your Instagram bio** (not a listing link).',
    '- Do NOT ask the AI to invent a shop URL; the bio already holds that link.',
    '- DO end the caption with a clear UK-English line in that spirit, for example: “Interested in this item? The link to my store is in my bio.” or “Love this piece? You’ll find my store link in my bio — no DMs for listing links.”',
    '',
    'Please produce:',
    '1. **Caption** — Engaging caption ready to paste: short hook, friendly resale tone, UK English, tasteful line breaks; optional relevant emojis; must follow the bio CTA rule above and include no marketplace item links.',
    '2. **Hashtags** — A separate block at the end with 18–28 hashtags: mix brand-relevant, category, style, and general resale (#preloved #secondhand #menswear etc. as appropriate). No spaces inside tags; avoid spammy repetition; do not use hashtags whose purpose is to smuggle a URL.',
    '',
    'Output format: caption first, then a blank line, then hashtags as a single space-separated line.'
  );
  return lines.join('\n');
}

function buildStockListingImageBackgroundPrompt(
  brandName: string,
  logoReferenceUrl?: string | null
): string {
  const brand =
    brandName.trim() && brandName.trim() !== '(not set)'
      ? brandName.trim()
      : '(specify the clothing brand — not set on this stock item)';
  const logoUrl = typeof logoReferenceUrl === 'string' ? logoReferenceUrl.trim() : '';
  const logoPreamble = logoUrl
    ? [
        `Use **this specific** **${brand}** logo — not a generic mark, redraw, or guess. The example below is the exact asset to replicate (open the URL to view or download; attach it in this chat next to my product photo if your tool supports multiple images):`,
        '',
        `Example logo image URL:\n${logoUrl}`,
        '',
      ]
    : [];
  const step4 = logoUrl
    ? [
        `4. Composite **that same** logo from the example URL above onto the listing image.`,
        '   - Match it as closely as possible (shape, proportions, colours, typography). Do not invent or substitute a different logo.',
        '   - Prefer a thin, tall (vertical) lock-up when the example allows; otherwise follow the example layout.',
        '   - The logo must be at most **12% of the total image height**.',
      ]
    : [
        `4. Add the **${brand}** clothing brand logo.`,
        '   - Use a thin, tall (vertical) lock-up rather than a wide horizontal logo if multiple layouts exist.',
        '   - The logo must be at most **12% of the total image height**.',
      ];
  return [
    'I will upload a product photo of a clothing item. Use my upload as the source image.',
    '',
    'Prepare the image to improve online sales:',
    '',
    '1. Remove the background so the garment is cleanly cut out.',
    '2. Add a light, neutral grey gradient background, slightly brighter toward the centre (focal emphasis in the middle).',
    '3. Keep clear space on both sides of the item; centre the garment if needed for a balanced composition.',
    ...logoPreamble,
    ...step4,
    '5. Make the clothing item as large as possible within the frame using the remaining space after the logo and margins — the product should dominate; the logo stays secondary.',
    '',
    'Deliver one polished listing-ready image suitable for marketplaces.',
    '',
    'Important — accuracy for resale:',
    '- Do **not** alter the item itself: no recolouring, “improving” fabric, removing damage, changing shape, or swapping parts of the garment.',
    '- If a **stand**, hanger, mannequin, or similar support is visible, **keep it as-is** and do **not** remove, replace, or redraw it (do not invent a different support).',
    '- This image will be used **to sell the actual item**; misrepresenting the product would **breach marketplace selling guidelines** (accurate photos only). Background and logo treatment must not change how the item honestly appears.',
  ].join('\n');
}

/** Preserve numeric 0 from the API; avoid falsy checks that drop 0. */
function stockDbNumberToFormString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

const Stock: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const setStockEditIdInUrl = useCallback(
    (id: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('editId', String(id));
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const clearStockEditIdFromUrl = useCallback(() => {
    setSearchParams(
      (prev) => {
        if (!prev.get('editId')) return prev;
        const next = new URLSearchParams(prev);
        next.delete('editId');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof StockRow;
    direction: 'asc' | 'desc';
  } | null>(null);
  const now = useMemo(() => new Date(), []);
  const currentYear = String(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState<string>('all-time');
  const [selectedWeek, setSelectedWeek] = useState<string>('off');
  const [viewMode, setViewMode] = useState<
    'all' | 'active-listing' | 'sales' | 'listing' | 'to-list' | 'list-on-vinted' | 'list-on-ebay' | 'inventory-write-off'
  >('all');
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<StockCreateFormState>({
    item_name: '',
    department_id: '',
    category_id: '',
    purchase_price: '',
    purchase_date: '',
    sale_date: '',
    sale_price: '',
    sold_platform: '',
    vinted_id: '',
    ebay_id: '',
    depop_id: '',
    brand_id: '',
    brand_tag_image_id: '',
    projected_sale_price: '',
    category_size_id: '',
    sourced_location: 'charity_shop',
    inventory_write_off: false,
    bulky_item: false,
    ebay_draft: false
  });
  const [categorySizes, setCategorySizes] = useState<CategorySizeRow[]>([]);
  const [categorySizesLoading, setCategorySizesLoading] = useState(false);
  const [brandTagImages, setBrandTagImages] = useState<BrandTagImageRow[]>([]);
  const [brandTagImagesLoading, setBrandTagImagesLoading] = useState(false);
  const [brandTagImagesError, setBrandTagImagesError] = useState<string | null>(null);
  const [stockTagDropdownOpen, setStockTagDropdownOpen] = useState(false);
  const stockTagDropdownRef = useRef<HTMLDivElement>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSuggestions, setTypeaheadSuggestions] = useState<string[]>([]);
  const [unsoldFilter, setUnsoldFilter] = useState<'off' | '3' | '6' | '12'>('off');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('');
  const [showSoldPlatformDropdown, setShowSoldPlatformDropdown] = useState(false);
  const soldPlatformDropdownRef = useRef<HTMLDivElement>(null);
  /** True when the row being edited is already in the Orders list (server `orders` table). */
  const [editingRowInOrders, setEditingRowInOrders] = useState(false);
  /** True while POST /api/orders is in flight — button shows disabled / pending styling. */
  const [addingToOrder, setAddingToOrder] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showWriteOffConfirm, setShowWriteOffConfirm] = useState(false);
  const [showCreateInsteadOfEditConfirm, setShowCreateInsteadOfEditConfirm] = useState(false);
  const [showChangeSkuModal, setShowChangeSkuModal] = useState(false);
  const [changeSkuNextId, setChangeSkuNextId] = useState<number | null>(null);
  const [changeSkuManualId, setChangeSkuManualId] = useState('');
  const [changeSkuLoading, setChangeSkuLoading] = useState(false);
  const [changeSkuError, setChangeSkuError] = useState<string | null>(null);
  /** Tracks whether the open form was started from row edit (+ Add sets 'create'). Used to catch accidental POST after edit context was lost. */
  const [formIntent, setFormIntent] = useState<'create' | 'edit'>('create');
  const [deleting, setDeleting] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);
  /** Block auto-opening `?editId=` for this SKU until the param changes or is cleared (avoids reopen after save). */
  const suppressAutoOpenEditSkuRef = useRef<number | null>(null);
  const [stockPage, setStockPage] = useState(1);
  const [stockTotalCount, setStockTotalCount] = useState(0);
  const [stockTotalPages, setStockTotalPages] = useState(1);
  const [summaryTotals, setSummaryTotals] = useState({ purchase: 0, sale: 0, profit: 0 });
  const [nextSku, setNextSku] = useState(1);
  const stockFiltersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAddingToOrder(false);
    if (editingRowId == null) {
      setEditingRowInOrders(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/orders`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const stockIds = new Set(
          (data.rows ?? []).map((r: { stock_id?: number | string }) => Number(r.stock_id))
        );
        if (!cancelled) {
          setEditingRowInOrders(stockIds.has(Number(editingRowId)));
        }
      } catch {
        if (!cancelled) setEditingRowInOrders(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingRowId]);

  /** Sold sale prices for other items with the same brand + category as the edit form (excludes the row being edited). */
  const editFormBrandCategorySaleComps = useMemo(() => {
    const bidRaw = createForm.brand_id;
    const cidRaw = createForm.category_id;
    if (bidRaw === '' || cidRaw === '' || bidRaw === undefined || cidRaw === undefined) {
      return { ready: false as const, reason: 'incomplete' as const };
    }
    const bid = Number(bidRaw);
    const cid = Number(cidRaw);
    if (!Number.isFinite(bid) || !Number.isFinite(cid)) {
      return { ready: false as const, reason: 'incomplete' as const };
    }

    const prices: number[] = [];
    for (const r of rows) {
      if (editingRowId !== null && Number(r.id) === Number(editingRowId)) continue;
      if (r.brand_id == null || Number(r.brand_id) !== bid) continue;
      if (r.category_id == null || Number(r.category_id) !== cid) continue;
      if (!r.sale_date) continue;
      const sp = typeof r.sale_price === 'number' ? r.sale_price : Number(r.sale_price ?? 0);
      if (!Number.isFinite(sp) || sp <= 0) continue;
      prices.push(sp);
    }

    if (prices.length === 0) {
      return { ready: true as const, count: 0, avg: null as number | null, max: null as number | null };
    }
    const sum = prices.reduce((x, y) => x + y, 0);
    return {
      ready: true as const,
      count: prices.length,
      avg: sum / prices.length,
      max: Math.max(...prices),
    };
  }, [rows, createForm.brand_id, createForm.category_id, editingRowId]);

  const defaultDepartmentId = useMemo(() => {
    const d = departments.find(
      (x) => x.department_name.trim().toLowerCase() === 'menswear'
    );
    return d != null ? String(d.id) : '';
  }, [departments]);

  const categoriesForDepartment = useMemo(() => {
    const d = createForm.department_id?.trim();
    if (!d) return [];
    return categories.filter((c) => String(c.department_id ?? '') === d);
  }, [categories, createForm.department_id]);

  /** Brand dropdown: brands for selected stock category (legacy: department-only brands with null category_id). */
  const brandsForBrandSelect = useMemo(() => {
    const d = createForm.department_id?.trim();
    const catId = createForm.category_id?.trim();
    const bid = createForm.brand_id?.trim();
    if (!d || !catId) return [];
    const forCategory = brands.filter(
      (b) =>
        String(b.category_id ?? '') === catId ||
        (b.category_id == null && String(b.department_id ?? '') === d)
    );
    const sorted = [...forCategory].sort((a, b) =>
      a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' })
    );
    if (!bid) return sorted;
    if (sorted.some((b) => String(b.id) === bid)) return sorted;
    const current = brands.find((b) => String(b.id) === bid);
    return current ? [current, ...sorted] : sorted;
  }, [brands, createForm.department_id, createForm.category_id, createForm.brand_id]);

  useEffect(() => {
    if (defaultDepartmentId === '') return;
    setCreateForm((prev) => {
      if (prev.department_id !== '') return prev;
      return { ...prev, department_id: defaultDepartmentId };
    });
  }, [defaultDepartmentId]);

  // Scroll entry form to top of page when add/edit opens
  useEffect(() => {
    if (!showNewEntry || !editFormRef.current) return undefined;

    const timeoutId = window.setTimeout(() => {
      scrollStockEntryFormIntoView(editFormRef.current);
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showNewEntry, editingRowId]);

  const buildStockListQueryParams = useCallback(
    (page: number, options?: { includeEditId?: boolean }) => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(STOCK_PAGE_SIZE));

      if (sortConfig) {
        params.set('sort', String(sortConfig.key));
        params.set('order', sortConfig.direction);
      } else {
        params.set('sort', 'id');
        params.set('order', 'desc');
      }

      if (searchTerm.trim()) {
        params.set('q', searchTerm.trim());
      }

      if (unsoldFilter !== 'off') {
        params.set('unsold', unsoldFilter);
      } else if (!searchTerm.trim()) {
        params.set('view', viewMode);
        params.set('year', selectedYear);
        if (selectedYear !== 'all-time' && selectedYear !== 'last-30-days') {
          params.set('month', selectedMonth);
        }
        if (selectedWeek !== 'off') {
          params.set('week_start', selectedWeek);
        }
      }

      if (selectedCategoryFilter) {
        const selectedCategory = categories.find(
          (cat) => cat.category_name === selectedCategoryFilter
        );
        if (selectedCategory) {
          params.set('category_id', String(selectedCategory.id));
        }
      }

      const toListCategory = categories.find((cat) => cat.category_name === 'To List');
      if (toListCategory) {
        params.set('to_list_category_id', String(toListCategory.id));
      }

      if (options?.includeEditId) {
        const editIdParam = searchParams.get('editId');
        if (editIdParam) {
          params.set('edit_id', editIdParam);
        }
      }

      return params;
    },
    [
      sortConfig,
      searchTerm,
      unsoldFilter,
      viewMode,
      selectedYear,
      selectedMonth,
      selectedWeek,
      selectedCategoryFilter,
      categories,
      searchParams,
    ]
  );

  const loadStockSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('year', selectedYear);
      if (selectedYear !== 'all-time' && selectedYear !== 'last-30-days') {
        params.set('month', selectedMonth);
      }
      if (selectedWeek !== 'off') {
        params.set('week_start', selectedWeek);
      }

      const response = await fetch(`${API_BASE}/api/stock/summary?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) return;
      const data: StockSummaryResponse = await response.json();
      setSummaryTotals({
        purchase: Number(data.total_purchase ?? 0),
        sale: Number(data.total_sales ?? 0),
        profit: Number(data.total_profit ?? 0),
      });
    } catch (err) {
      console.error('Stock summary load error:', err);
    }
  }, [selectedMonth, selectedYear, selectedWeek]);

  const loadNextSku = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stock/next-id`);
      if (!res.ok) return;
      const data = await res.json();
      const nextId = Number(data.next_id);
      if (Number.isFinite(nextId) && nextId >= 1) {
        setNextSku(nextId);
      }
    } catch (err) {
      console.error('Failed to load next SKU:', err);
    }
  }, []);

  const loadStockPage = useCallback(
    async (page: number, options?: { includeEditId?: boolean }) => {
      try {
        setLoading(true);
        setError(null);

        const params = buildStockListQueryParams(page, {
          includeEditId: options?.includeEditId,
        });
        const response = await fetch(`${API_BASE}/api/stock?${params.toString()}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || 'Failed to load stock data');
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(text || 'Unexpected response format');
        }

        const data: StockApiResponse = await response.json();
        const nextRows = (Array.isArray(data.rows) ? data.rows : []).map(normalizeStockRowDates);
        const total = Number(data.total ?? data.count ?? nextRows.length);
        const totalPages = Math.max(1, Number(data.total_pages ?? Math.ceil(total / STOCK_PAGE_SIZE)));
        const resolvedPage = Number(data.page ?? page);

        if (
          options?.includeEditId &&
          data.edit_page != null &&
          Number(data.edit_page) > 0 &&
          Number(data.edit_page) !== resolvedPage
        ) {
          setStockPage(Number(data.edit_page));
          return;
        }

        setRows(nextRows);
        setStockTotalCount(total);
        setStockTotalPages(totalPages);
        setStockPage(resolvedPage);
      } catch (err: any) {
        console.error('Stock load error:', err);
        if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
          setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
        } else {
          setError(err.message || 'Unable to load stock data');
        }
        setRows([]);
        setStockTotalCount(0);
        setStockTotalPages(1);
      } finally {
        setLoading(false);
      }
    },
    [buildStockListQueryParams]
  );

  const loadStock = useCallback(() => {
    void loadStockPage(stockPage);
    void loadStockSummary();
    void loadNextSku();
  }, [loadStockPage, loadStockSummary, loadNextSku, stockPage]);

  const loadBrands = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const raw = Array.isArray(data.rows) ? data.rows : [];
        const mapped: Brand[] = raw
          .map((r: Record<string, unknown>) => {
            const id = Math.floor(Number(r.id));
            const depRaw = r.department_id;
            let department_id: number | null = null;
            if (depRaw !== undefined && depRaw !== null && depRaw !== '') {
              const x = Math.floor(Number(depRaw));
              if (Number.isFinite(x) && x >= 1) department_id = x;
            }
            const catRaw = r.category_id;
            let category_id: number | null = null;
            if (catRaw !== undefined && catRaw !== null && catRaw !== '') {
              const y = Math.floor(Number(catRaw));
              if (Number.isFinite(y) && y >= 1) category_id = y;
            }
            return {
              id: Number.isFinite(id) && id >= 1 ? id : -1,
              brand_name: String(r.brand_name ?? '').trim(),
              department_id,
              category_id,
            };
          })
          .filter((b: Brand) => b.id >= 1);
        setBrands(mapped);
      }
    } catch (err) {
      console.error('Failed to load brands:', err);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/departments`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        setDepartments(Array.isArray(data.rows) ? data.rows : []);
      }
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  useEffect(() => {
    pingDatabase();
    loadCategories();
    loadBrands();
    loadDepartments();
    void loadNextSku();
  }, [loadNextSku]);

  useEffect(() => {
    void loadStockPage(stockPage, { includeEditId: Boolean(searchParams.get('editId')) });
  }, [loadStockPage, stockPage, searchParams]);

  useEffect(() => {
    void loadStockSummary();
  }, [loadStockSummary]);

  useEffect(() => {
    setStockPage(1);
  }, [
    selectedMonth,
    selectedYear,
    selectedWeek,
    viewMode,
    searchTerm,
    unsoldFilter,
    selectedCategoryFilter,
    sortConfig,
  ]);

  useEffect(() => {
    pingDatabase();
    const intervalId = window.setInterval(pingDatabase, 4 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const populateEditFormFromRow = useCallback(
    (rowToEdit: StockRow) => {
      setFormIntent('edit');
      setEditingRowId(rowToEdit.id);
      const deptForRow =
        rowToEdit.category_id != null
          ? (() => {
              const cat = categories.find((c) => Number(c.id) === Number(rowToEdit.category_id));
              if (cat?.department_id != null) return String(cat.department_id);
              return defaultDepartmentId;
            })()
          : defaultDepartmentId;
      setCreateForm({
        item_name: rowToEdit.item_name ?? '',
        department_id: deptForRow,
        category_id: rowToEdit.category_id ? String(rowToEdit.category_id) : '',
        purchase_price: stockDbNumberToFormString(rowToEdit.purchase_price),
        purchase_date: normalizeDateOnlyString(rowToEdit.purchase_date ?? ''),
        sale_date: normalizeDateOnlyString(rowToEdit.sale_date ?? ''),
        sale_price: stockDbNumberToFormString(rowToEdit.sale_price),
        sold_platform: rowToEdit.sold_platform ?? '',
        vinted_id: rowToEdit.vinted_id ?? '',
        ebay_id: rowToEdit.ebay_id ?? '',
        depop_id: rowToEdit.depop_id ?? '',
        brand_id: rowToEdit.brand_id ? String(rowToEdit.brand_id) : '',
        brand_tag_image_id:
          rowToEdit.brand_tag_image_id != null ? String(rowToEdit.brand_tag_image_id) : '',
        projected_sale_price: stockDbNumberToFormString(rowToEdit.projected_sale_price),
        category_size_id:
          rowToEdit.category_size_id != null ? String(rowToEdit.category_size_id) : '',
        sourced_location: sourcedLocationFromRow(rowToEdit),
        inventory_write_off: stockRowWriteOffFromRow(rowToEdit),
        bulky_item: stockRowBulkyFromRow(rowToEdit),
        ebay_draft: stockRowEbayDraftFromRow(rowToEdit),
      });
      setShowNewEntry(true);
      setSuccessMessage(null);
    },
    [categories, defaultDepartmentId]
  );

  // Open edit form when `?editId=` is present (Orders deep-link, refresh, browser back).
  useEffect(() => {
    const editIdParam = searchParams.get('editId');
    if (!editIdParam) {
      suppressAutoOpenEditSkuRef.current = null;
      return;
    }
    if (loading || editingRowId != null || creating) {
      return;
    }
    const editId = parseInt(editIdParam, 10);
    if (Number.isNaN(editId)) {
      clearStockEditIdFromUrl();
      return;
    }
    if (
      suppressAutoOpenEditSkuRef.current !== null &&
      suppressAutoOpenEditSkuRef.current !== editId
    ) {
      suppressAutoOpenEditSkuRef.current = null;
    }
    if (suppressAutoOpenEditSkuRef.current === editId) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/stock/row/${editId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          if (!cancelled) clearStockEditIdFromUrl();
          return;
        }
        const data = await response.json();
        const rowToEdit = data?.row ? normalizeStockRowDates(data.row as StockRow) : null;
        if (!rowToEdit || cancelled) {
          if (!cancelled) clearStockEditIdFromUrl();
          return;
        }
        populateEditFormFromRow(rowToEdit);

        let scrollTimeoutId: ReturnType<typeof setTimeout> | undefined;
        scrollTimeoutId = setTimeout(() => {
          scrollStockEntryFormIntoView(editFormRef.current);
        }, 150);

        return () => {
          if (scrollTimeoutId != null) clearTimeout(scrollTimeoutId);
        };
      } catch (err) {
        console.error('Failed to load stock row for edit:', err);
        if (!cancelled) clearStockEditIdFromUrl();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    searchParams,
    editingRowId,
    creating,
    clearStockEditIdFromUrl,
    populateEditFormFromRow,
  ]);

  useEffect(() => {
    const bid = createForm.brand_id?.trim();
    if (!bid) {
      setBrandTagImages([]);
      setBrandTagImagesError(null);
      setBrandTagImagesLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      setBrandTagImagesLoading(true);
      setBrandTagImagesError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/brand-tag-images?brandId=${encodeURIComponent(bid)}`,
          { signal: ac.signal }
        );
        const data = (await res.json()) as { rows?: BrandTagImageRow[]; error?: string; details?: string };
        if (!res.ok) {
          throw new Error(data?.details || data?.error || 'Failed to load brand tags');
        }
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (cancelled) return;
        setBrandTagImages(rows);
        setCreateForm((prev) => {
          if (!prev.brand_tag_image_id?.trim()) return prev;
          const row = rows.find((r) => String(r.id) === String(prev.brand_tag_image_id));
          const ok = row != null && row.image_kind !== 'logo';
          return ok ? prev : { ...prev, brand_tag_image_id: '' };
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setBrandTagImages([]);
        setBrandTagImagesError(e instanceof Error ? e.message : 'Failed to load brand tags');
      } finally {
        if (!cancelled) setBrandTagImagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [createForm.brand_id]);

  useEffect(() => {
    const cid = createForm.category_id?.trim();
    if (!cid) {
      setCategorySizes([]);
      setCategorySizesLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      setCategorySizesLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/category-sizes?categoryId=${encodeURIComponent(cid)}`,
          { signal: ac.signal }
        );
        const data = (await res.json()) as { rows?: CategorySizeRow[]; error?: string };
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load sizes');
        }
        const list = Array.isArray(data.rows) ? data.rows : [];
        if (cancelled) return;
        setCategorySizes(list);
        setCreateForm((prev) => {
          if (!prev.category_size_id?.trim()) return prev;
          const ok = list.some((r) => String(r.id) === String(prev.category_size_id));
          return ok ? prev : { ...prev, category_size_id: '' };
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setCategorySizes([]);
        setCreateForm((prev) =>
          prev.category_size_id ? { ...prev, category_size_id: '' } : prev
        );
      } finally {
        if (!cancelled) setCategorySizesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [createForm.category_id]);

  useEffect(() => {
    setStockTagDropdownOpen(false);
  }, [createForm.brand_id]);

  useEffect(() => {
    if (!stockTagDropdownOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = stockTagDropdownRef.current;
      if (el && !el.contains(e.target as Node)) {
        setStockTagDropdownOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStockTagDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [stockTagDropdownOpen]);

  const selectedBrandTagImage = useMemo(
    () => brandTagImages.find((t) => String(t.id) === String(createForm.brand_tag_image_id)),
    [brandTagImages, createForm.brand_tag_image_id]
  );

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/categories`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCategories(Array.isArray(data.rows) ? data.rows : []);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      return;
    }

    if (!createForm.department_id?.trim()) {
      setError('Select a department before adding a category');
      return;
    }

    const categoryName = newCategoryName.trim();
    const deptId = createForm.department_id.trim();

    // Same name may exist in another department; only block duplicates within the selected department
    const categoryExists = categories.some(
      (c) =>
        String(c.department_id ?? '') === deptId &&
        (c.category_name ?? '').toLowerCase() === categoryName.toLowerCase()
    );
    if (categoryExists) {
      setError('A category with this name already exists in this department');
      return;
    }

    setSavingCategory(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category_name: categoryName,
          department_id: Number(createForm.department_id),
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to add category';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
          console.error('Category API error:', errorData);
        } catch (e) {
          const text = await response.text();
          console.error('Category API error (text):', text);
          errorMessage = text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Reload categories to get the updated list
      await loadCategories();
      // Set the newly created category as selected
      if (data.row && data.row.id) {
        handleCreateChange('category_id', String(data.row.id));
      }
      setNewCategoryName('');
      setShowAddCategory(false);
      setSuccessMessage('Category added successfully');
    } catch (err: any) {
      console.error('Failed to add category:', err);
      setError(err.message || 'Failed to add category');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleAddBrand = async () => {
    if (!newBrandName.trim()) {
      return;
    }

    if (!createForm.department_id?.trim()) {
      setError('Select a department before adding a brand');
      return;
    }

    if (!createForm.category_id?.trim()) {
      setError('Select a category before adding a brand');
      return;
    }

    const brandName = newBrandName.trim();
    const deptId = Number(createForm.department_id);
    const catId = Number(createForm.category_id);

    const brandExists = brands.some(
      (b) =>
        b.brand_name.toLowerCase() === brandName.toLowerCase() &&
        String(b.category_id ?? '') === String(catId)
    );
    if (brandExists) {
      setError('A brand with this name already exists in this category');
      return;
    }

    setSavingBrand(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_name: brandName,
          department_id: deptId,
          category_id: catId,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to add brand';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
          console.error('Brand API error:', errorData);
        } catch (e) {
          const text = await response.text();
          console.error('Brand API error (text):', text);
          errorMessage = text || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Reload brands to get the updated list
      await loadBrands();
      // Set the newly created brand as selected
      if (data.row && data.row.id) {
        handleCreateChange('brand_id', String(data.row.id));
      }
      setNewBrandName('');
      setShowAddBrand(false);
      setSuccessMessage('Brand added successfully');
    } catch (err: any) {
      console.error('Failed to add brand:', err);
      setError(err.message || 'Failed to add brand');
    } finally {
      setSavingBrand(false);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showSoldPlatformDropdown && soldPlatformDropdownRef.current && !soldPlatformDropdownRef.current.contains(event.target as Node)) {
        setShowSoldPlatformDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSoldPlatformDropdown]);


  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const availableYears = useMemo(() => {
    const years: string[] = ['all-time', 'last-30-days'];
    const current = now.getFullYear();
    for (let year = current; year >= current - 15; year -= 1) {
      years.push(String(year));
    }
    return years;
  }, [now]);

  useEffect(() => {
    if (availableYears.length === 0) {
      return;
    }

    // If selectedYear is not "all-time", "last-30-days", and not in available years, reset to all-time
    if (selectedYear !== 'all-time' && selectedYear !== 'last-30-days' && !availableYears.includes(selectedYear) && selectedYear !== currentYear) {
      setSelectedYear('all-time');
    }
  }, [availableYears, selectedYear, currentYear]);

  // Generate weeks for the selected month and year
  const availableWeeks = useMemo(() => {
    if (selectedYear === 'all-time' || selectedYear === 'last-30-days') {
      return [];
    }

    const year = parseInt(selectedYear, 10);
    const month = parseInt(selectedMonth, 10) - 1; // JavaScript months are 0-indexed

    if (Number.isNaN(year) || Number.isNaN(month)) {
      return [];
    }

    const weeks: Array<{ value: string; label: string; startDate: Date; endDate: Date }> = [];
    
    // Get the first day of the month
    const firstDay = new Date(year, month, 1);
    
    // Find the Monday of the week containing the first day
    const firstMonday = new Date(firstDay);
    const dayOfWeek = firstMonday.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days, otherwise go back (dayOfWeek - 1) days
    firstMonday.setDate(firstMonday.getDate() - daysToMonday);
    
    // Get the last day of the month
    const lastDay = new Date(year, month + 1, 0);
    
    // Find the Sunday of the week containing the last day
    const lastSunday = new Date(lastDay);
    const lastDayOfWeek = lastSunday.getDay();
    const daysToSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    lastSunday.setDate(lastSunday.getDate() + daysToSunday);
    
    // Generate all weeks from first Monday to last Sunday
    let currentWeekStart = new Date(firstMonday);
    
    while (currentWeekStart <= lastSunday) {
      const weekEnd = new Date(currentWeekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // Sunday is 6 days after Monday
      
      // Format: "Mon DD - Sun DD MMM" or "Mon DD MMM - Sun DD MMM" if different months
      const startDay = currentWeekStart.getDate();
      const endDay = weekEnd.getDate();
      const startMonth = currentWeekStart.toLocaleString('en-GB', { month: 'short' });
      const endMonth = weekEnd.toLocaleString('en-GB', { month: 'short' });
      
      let label: string;
      if (startMonth === endMonth) {
        label = `${startDay} - ${endDay} ${startMonth}`;
      } else {
        label = `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
      }
      
      // Use ISO date string for the Monday as the value
      const value = currentWeekStart.toISOString().split('T')[0];
      
      weeks.push({
        value,
        label,
        startDate: new Date(currentWeekStart),
        endDate: new Date(weekEnd)
      });
      
      // Move to next week (next Monday)
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    }
    
    return weeks;
  }, [selectedMonth, selectedYear]);

  const uniqueCategories = useMemo(
    () => categories.map((cat) => cat.category_name).filter(Boolean).sort(),
    [categories]
  );

  useEffect(() => {
    if (!searchTerm.trim()) {
      setTypeaheadSuggestions([]);
      setShowTypeahead(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `${API_BASE}/api/stock/item-names?q=${encodeURIComponent(searchTerm.trim())}`
          );
          if (!response.ok || cancelled) return;
          const data = await response.json();
          const names = Array.isArray(data.names) ? data.names : [];
          if (!cancelled) {
            setTypeaheadSuggestions(names.slice(0, 10));
            setShowTypeahead(names.length > 0);
          }
        } catch {
          if (!cancelled) {
            setTypeaheadSuggestions([]);
            setShowTypeahead(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  const totals = summaryTotals;

  const goToStockPage = (nextPage: number) => {
    const clamped = Math.min(Math.max(1, nextPage), stockTotalPages);
    setStockPage(clamped);
    stockFiltersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const startEditingRow = (row: StockRow) => {
    if (creating) {
      return;
    }
    suppressAutoOpenEditSkuRef.current = null;

    // Ensure row has a valid ID before setting editing state
    if (!row.id) {
      console.error('startEditingRow: Row has no ID', row);
      setError('Cannot edit item: missing ID');
      return;
    }

    populateEditFormFromRow(row);
    setStockEditIdInUrl(Number(row.id));

    setTimeout(() => {
      scrollStockEntryFormIntoView(editFormRef.current);
    }, 150);
  };

  const resetCreateForm = () => {
    setShowWriteOffConfirm(false);
    setCreateForm({
      item_name: '',
      department_id: defaultDepartmentId,
      category_id: '',
      purchase_price: '',
      purchase_date: '',
      sale_date: '',
      sale_price: '',
      sold_platform: '',
      vinted_id: '',
      ebay_id: '',
      depop_id: '',
      brand_id: '',
      brand_tag_image_id: '',
      projected_sale_price: '',
      category_size_id: '',
      sourced_location: 'charity_shop',
      inventory_write_off: false,
      bulky_item: false,
      ebay_draft: false
    });
  };

  const closeStockEntryPanel = () => {
    // While `?editId=` is still in the URL for a frame after `setSearchParams`, the deep-link effect
    // would otherwise see editingRowId=null + editId in URL and reopen—feels like a "double close" bug.
    if (editingRowId != null) {
      suppressAutoOpenEditSkuRef.current = Number(editingRowId);
    }
    clearStockEditIdFromUrl();
    setShowNewEntry(false);
    setEditingRowId(null);
    setFormIntent('create');
    setShowCreateInsteadOfEditConfirm(false);
    setShowDeleteConfirm(false);
    setShowWriteOffConfirm(false);
    resetCreateForm();
  };

  const handleCreateChange = (
    key: Exclude<keyof StockCreateFormState, 'inventory_write_off' | 'bulky_item' | 'ebay_draft'>,
    value: string
  ) => {
    setCreateForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'brand_id' && value !== prev.brand_id) {
        next.brand_tag_image_id = '';
      }
      if (key === 'department_id' && value !== prev.department_id) {
        const keepCat =
          prev.category_id &&
          categories.some(
            (c) =>
              String(c.id) === String(prev.category_id) &&
              String(c.department_id ?? '') === String(value)
          );
        if (!keepCat) {
          next.category_id = '';
          next.category_size_id = '';
        }
        const keepBrand =
          prev.brand_id &&
          String(value).trim() !== '' &&
          brands.some(
            (b) =>
              String(b.id) === String(prev.brand_id) &&
              (String(b.department_id ?? '') === String(value) ||
                (prev.category_id &&
                  String(b.category_id ?? '') === String(prev.category_id)))
          );
        if (!keepBrand) {
          next.brand_id = '';
          next.brand_tag_image_id = '';
        }
      }
      if (key === 'category_id' && value !== prev.category_id) {
        next.category_size_id = '';
        const keepBrand =
          prev.brand_id &&
          value.trim() !== '' &&
          brands.some(
            (b) =>
              String(b.id) === String(prev.brand_id) &&
              (String(b.category_id ?? '') === String(value) ||
                (b.category_id == null &&
                  String(b.department_id ?? '') === String(prev.department_id)))
          );
        if (!keepBrand) {
          next.brand_id = '';
          next.brand_tag_image_id = '';
        }
      }
      return next;
    });
  };

  const handleCreateSubmit = async (
    options?: boolean | { allowCreateDespiteEditIntent?: boolean; addToOrdersAfterSave?: boolean }
  ) => {
    const opts =
      typeof options === 'boolean'
        ? { allowCreateDespiteEditIntent: options }
        : options ?? {};
    const currentEditingId = editingRowId;
    const forceCreate = opts.allowCreateDespiteEditIntent === true;
    const addToOrdersAfterSave = opts.addToOrdersAfterSave === true;

    if (currentEditingId === null && formIntent === 'edit' && !forceCreate) {
      setShowCreateInsteadOfEditConfirm(true);
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setShowCreateInsteadOfEditConfirm(false);

      if (!createForm.purchase_date?.trim()) {
        setError('Purchase date is required.');
        setCreating(false);
        return;
      }

      const payload = {
        item_name: createForm.item_name,
        category_id: createForm.category_id ? Number(createForm.category_id) : null,
        purchase_price: createForm.purchase_price,
        purchase_date: normalizeDateOnlyString(createForm.purchase_date),
        sale_date: normalizeDateOnlyString(createForm.sale_date) || null,
        sale_price: createForm.sale_price,
        sold_platform: createForm.sold_platform,
        vinted_id: createForm.vinted_id ? createForm.vinted_id.trim() : null,
        ebay_id: createForm.ebay_id ? createForm.ebay_id.trim() : null,
        depop_id: createForm.depop_id ? createForm.depop_id.trim() : null,
        brand_id: createForm.brand_id ? Number(createForm.brand_id) : null,
        brand_tag_image_id:
          createForm.brand_id && createForm.brand_tag_image_id.trim() !== ''
            ? Number(createForm.brand_tag_image_id)
            : null,
        projected_sale_price: createForm.projected_sale_price || null,
        category_size_id:
          createForm.category_id && createForm.category_size_id.trim() !== ''
            ? Number(createForm.category_size_id)
            : null,
        sourced_location: createForm.sourced_location || 'charity_shop',
        is_inventory_write_off: createForm.inventory_write_off,
        is_bulky_item: createForm.bulky_item,
        is_ebay_draft: createForm.ebay_draft
      };

      // Check if we're editing or creating
      const isEditing = currentEditingId !== null;
      const url = isEditing ? `${API_BASE}/api/stock/${currentEditingId}` : `${API_BASE}/api/stock`;
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = 'Failed to create stock record';
        try {
          const errorBody = await response.json();
          message = errorBody?.details || errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data = await response.json();
      const updatedRow: StockRow | undefined = data?.row ? normalizeStockRowDates(data.row) : undefined;

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      if (isEditing) {
        setRows((prev) =>
          prev.map((row) =>
            Number(row.id) === Number(updatedRow.id) ? updatedRow : row
          )
        );
        if (addToOrdersAfterSave) {
          setAddingToOrder(true);
          try {
            const orderResponse = await fetch(`${API_BASE}/api/orders`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ stock_id: updatedRow.id }),
            });
            if (orderResponse.status === 409) {
              setSuccessMessage('Saved and closed — item was already in orders.');
            } else if (!orderResponse.ok) {
              let message = 'Saved, but could not add item to orders';
              try {
                const errorBody = await orderResponse.json();
                message = errorBody?.error || message;
              } catch {
                const text = await orderResponse.text();
                message = text || message;
              }
              throw new Error(message);
            } else {
              setEditingRowInOrders(true);
              setSuccessMessage('Saved, added to orders, and closed.');
            }
          } catch (orderErr: any) {
            console.error('Add to orders after save error:', orderErr);
            setError(orderErr.message || 'Saved, but unable to add item to orders');
            setCreating(false);
            setAddingToOrder(false);
            return;
          } finally {
            setAddingToOrder(false);
          }
        } else {
          setSuccessMessage('Stock record updated successfully.');
        }
      } else {
        setStockPage(1);
        setSuccessMessage('Stock record created successfully.');
      }

      // Close panel and clear URL; block this SKU from auto-reopening until `editId` leaves the URL
      suppressAutoOpenEditSkuRef.current = Number(updatedRow.id);
      closeStockEntryPanel();
      setSortConfig(null);

      void loadStockPage(isEditing ? stockPage : 1);
      void loadStockSummary();
      void loadNextSku();

      window.setTimeout(() => {
        stockFiltersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (err: any) {
      console.error('Stock create error:', err);
      setError(err.message || 'Unable to create stock record');
    } finally {
      setCreating(false);
    }
  };

  const renderCellContent = (
    row: StockRow,
    key: keyof Omit<StockRow, 'id'>,
    formatter?: (value: Nullable<string | number>) => string,
    isDate?: boolean
  ) => {
    // Special handling for category_id - display category name
    if (key === 'category_id') {
      const category = categories.find(cat => cat.id === row.category_id);
      return category ? category.category_name : '—';
    }

    const value = row[key];

    if (formatter) {
      return formatter(value as Nullable<string | number>);
    }

    return value ?? '—';
  };

  const handleSort = (key: keyof StockRow) => {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { key, direction: 'desc' };
      }

      return null;
    });
  };

  const resolveSortIndicator = (key: keyof StockRow) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '⇅';
    }

    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!editingRowId) return;

    try {
      setDeleting(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/stock/${editingRowId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        let message = 'Failed to delete stock record';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Remove the deleted row from state
      setRows((prev) =>
        prev.filter((row) => Number(row.id) !== Number(editingRowId))
      );
      setSuccessMessage('Stock record deleted successfully.');

      closeStockEntryPanel();
      void loadStockPage(stockPage);
      void loadStockSummary();
      void loadNextSku();
    } catch (err: any) {
      console.error('Stock delete error:', err);
      setError(err.message || 'Unable to delete stock record');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const openChangeSkuModal = async () => {
    if (!editingRowId) return;
    setChangeSkuError(null);
    setChangeSkuManualId('');
    setShowChangeSkuModal(true);
    try {
      const res = await fetch(`${API_BASE}/api/stock/next-id`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to load next SKU');
      }
      setChangeSkuNextId(Number(data.next_id));
    } catch (err) {
      setChangeSkuNextId(
        rows.length > 0 ? Math.max(...rows.map((r) => Number(r.id))) + 1 : editingRowId + 1
      );
      setChangeSkuError(err instanceof Error ? err.message : 'Could not load next SKU from server');
    }
  };

  const closeChangeSkuModal = () => {
    if (changeSkuLoading) return;
    setShowChangeSkuModal(false);
    setChangeSkuError(null);
    setChangeSkuManualId('');
  };

  const applyStockSkuChange = async (newId: number) => {
    if (!editingRowId) return;
    if (!Number.isInteger(newId) || newId < 1) {
      setChangeSkuError('Enter a valid positive SKU number');
      return;
    }
    if (newId === editingRowId) {
      setChangeSkuError('New SKU must be different from the current SKU');
      return;
    }

    setChangeSkuLoading(true);
    setChangeSkuError(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stock/${editingRowId}/change-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_id: newId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let msg = data.error || data.details || 'Failed to change SKU';
        if (Array.isArray(data.conflicting_ids) && data.conflicting_ids.length >= 2) {
          msg = `${msg} Conflicting SKU IDs: ${data.conflicting_ids.join(' and ')}.`;
        } else if (data.new_id != null && data.old_id != null && res.status === 409) {
          msg = `${msg} (SKU ${data.new_id} is already in use.)`;
        }
        throw new Error(msg);
      }

      const updatedRow = data.row as StockRow;
      const oldId = editingRowId;

      setRows((prev) =>
        prev
          .filter((row) => Number(row.id) !== Number(oldId))
          .concat(updatedRow)
          .sort((a, b) => {
            const ad = dateOnlyToTime(a.purchase_date);
            const bd = dateOnlyToTime(b.purchase_date);
            if (bd !== ad) return bd - ad;
            return String(a.item_name ?? '').localeCompare(String(b.item_name ?? ''));
          })
      );

      suppressAutoOpenEditSkuRef.current = newId;
      setEditingRowId(newId);
      setStockEditIdInUrl(newId);
      setShowChangeSkuModal(false);
      setChangeSkuManualId('');
      setSuccessMessage(`SKU updated from ${oldId} to ${newId}`);

      try {
        const ordersRes = await fetch(`${API_BASE}/api/orders`);
        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          const stockIds = new Set(
            (ordersData.rows ?? []).map((r: { stock_id?: number | string }) => Number(r.stock_id))
          );
          setEditingRowInOrders(stockIds.has(newId));
        }
      } catch {
        /* ignore */
      }
    } catch (err) {
      setChangeSkuError(err instanceof Error ? err.message : 'Failed to change SKU');
    } finally {
      setChangeSkuLoading(false);
    }
  };

  const handleInstagramAskAi = useCallback(async () => {
    if (!editingRowId) return;
    setError(null);
    const brandName =
      brands.find((b) => String(b.id) === String(createForm.brand_id))?.brand_name?.trim() ||
      '(not set)';
    const categoryName =
      categories.find((c) => String(c.id) === String(createForm.category_id))?.category_name?.trim() ||
      '(not set)';
    const itemName = createForm.item_name.trim() || '(no title)';
    const text = buildStockInstagramAskAiPrompt({
      itemName,
      brandName,
      categoryName,
      sku: editingRowId,
    });
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMessage(
        'Instagram Prompt copied — points people to your store via bio only (no item / marketplace links). Paste into your AI tool.'
      );
      window.setTimeout(() => setSuccessMessage(null), 5000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }, [editingRowId, brands, categories, createForm]);

  const handleCopyListingImageBgPrompt = useCallback(async () => {
    if (!editingRowId) return;
    setError(null);
    const brandName =
      brands.find((b) => String(b.id) === String(createForm.brand_id))?.brand_name?.trim() ||
      '(not set)';
    const logoRow = brandTagImages.find((t) => t.image_kind === 'logo');
    const logoUrl = logoRow?.public_url?.trim() || null;
    const text = buildStockListingImageBackgroundPrompt(brandName, logoUrl);
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMessage(
        logoUrl
          ? 'Image Prompt copied — includes your brand logo URL; paste into your AI tool, then attach your product photo and the logo image if supported.'
          : 'Image Prompt copied — paste into ChatGPT, then upload your photo when asked.'
      );
      window.setTimeout(() => setSuccessMessage(null), 5000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }, [editingRowId, brands, createForm.brand_id, brandTagImages]);

  const handleAddToOrders = async () => {
    if (!editingRowId || editingRowInOrders || addingToOrder) return;

    setError(null);
    setAddingToOrder(true);
    try {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stock_id: editingRowId }),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setEditingRowInOrders(true);
          return;
        }
        let message = 'Failed to add item to orders';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      setEditingRowInOrders(true);
      setSuccessMessage('Item added to orders list.');
    } catch (err: any) {
      console.error('Add to orders error:', err);
      setError(err.message || 'Unable to add item to orders');
    } finally {
      setAddingToOrder(false);
    }
  };

  const renderInventoryWriteOffField = (fieldId: string) => (
    <div className="new-entry-field stock-edit-write-off-field stock-new-entry-toggle-field">
      <span className="stock-edit-write-off-field-label" id={`stock-write-off-field-label-${fieldId}`}>
        Inventory write-off
        <span className="stock-edit-write-off-muted"> (unsellable)</span>
      </span>
      <div className="stock-edit-write-off-box">
        <label className="stock-edit-write-off-checkbox-label" htmlFor={`stock-inv-write-off-${fieldId}`}>
          <input
            id={`stock-inv-write-off-${fieldId}`}
            type="checkbox"
            checked={createForm.inventory_write_off}
            onChange={(e) => {
              if (e.target.checked) {
                setShowWriteOffConfirm(true);
              } else {
                setCreateForm((prev) => ({ ...prev, inventory_write_off: false }));
              }
            }}
            aria-labelledby={`stock-write-off-field-label-${fieldId}`}
          />
        </label>
      </div>
    </div>
  );

  const stockEntryFormEl = showNewEntry ? (
        <div className="new-entry-card" ref={editFormRef}>
          <div className="new-entry-grid">
            <div className="stock-new-entry-top-bar">
              <div
                className={
                  'stock-new-entry-top-bar-row-1' +
                  (editingRowId ? ' stock-new-entry-top-bar-row-1--edit' : '')
                }
              >
              <div className="stock-new-entry-top-bar-left">
                <button
                  type="button"
                  className={`cancel-button stock-close-circle-btn${editingRowId ? ' stock-close-circle-btn--edit' : ''}`}
                  onClick={() => {
                    if (!deleting) {
                      closeStockEntryPanel();
                    }
                  }}
                  disabled={deleting}
                  aria-label="Close"
                  title="Close"
                >
                  <svg
                    className="stock-close-circle-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
                {editingRowId ? (
                  <button
                    type="button"
                    className="stock-edit-sku-id-circle"
                    title={`SKU ${editingRowId} — click to change`}
                    aria-label={`Change SKU ${editingRowId}`}
                    onClick={() => void openChangeSkuModal()}
                    disabled={creating || deleting || changeSkuLoading}
                  >
                    {editingRowId}
                  </button>
                ) : null}
              </div>
              {editingRowId ? (
                <div className="stock-new-entry-top-bar-edit-actions">
                  <button
                    type="button"
                    className={`stock-add-to-order-btn stock-edit-row-1-add-to-order${editingRowInOrders ? ' stock-add-to-order-btn--in-orders' : ''}${addingToOrder ? ' stock-add-to-order-btn--adding' : ''}`}
                    onClick={handleAddToOrders}
                    disabled={creating || deleting || editingRowInOrders || addingToOrder}
                    aria-label={
                      editingRowInOrders
                        ? 'Item is in orders list'
                        : addingToOrder
                          ? 'Adding to orders…'
                          : 'Add item to orders'
                    }
                    title={
                      editingRowInOrders
                        ? 'Added — in orders list'
                        : addingToOrder
                          ? 'Adding…'
                          : 'Add to orders'
                    }
                  >
                    <AddToOrdersIcon className="stock-add-to-order-icon" />
                    {editingRowInOrders
                      ? 'In orders'
                      : addingToOrder
                        ? 'Adding…'
                        : 'Add to orders'}
                  </button>
                  <button
                    type="button"
                    className="stock-image-prompt-btn stock-edit-row-1-image-prompt"
                    onClick={handleCopyListingImageBgPrompt}
                    disabled={creating || deleting}
                    aria-label="Copy Image Prompt: ChatGPT — remove background, grey gradient, brand logo"
                    title="Copy prompt for ChatGPT: background removal, neutral grey gradient, brand logo (uses selected brand)"
                  >
                    <svg
                      className="stock-image-prompt-btn-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="8.5" cy="10" r="1.75" />
                      <path d="M21 17l-5.09-5.09a1.5 1.5 0 0 0-2.12 0L9 17" />
                    </svg>
                    Image Prompt
                  </button>
                  <button
                    type="button"
                    className="stock-instagram-ai-button stock-edit-row-1-instagram"
                    onClick={handleInstagramAskAi}
                    disabled={creating || deleting}
                    aria-label="Copy Instagram Prompt: caption and hashtags (shop link in bio only, no item URLs)"
                    title="Copy AI prompt: caption + hashtags — points people to your bio, no listing links"
                  >
                    <svg
                      className="stock-instagram-prompt-btn-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                    </svg>
                    Instagram Prompt
                  </button>
                </div>
              ) : null}
              <div
                className={
                  'stock-new-entry-top-bar-metrics' +
                  (!editingRowId ? ' stock-new-entry-top-bar-metrics--add' : '')
                }
              >
                <div className="new-entry-field stock-new-entry-top-bar-comps-field">
                  <div
                    className="stock-edit-brand-category-comps stock-new-entry-top-bar-comps"
                    role="region"
                    aria-label="Average and top sale price for this brand and category"
                  >
                    {!editFormBrandCategorySaleComps.ready && (
                      <p className="stock-edit-brand-category-comps__muted">Select brand &amp; category</p>
                    )}
                    {editFormBrandCategorySaleComps.ready && editFormBrandCategorySaleComps.count === 0 && (
                      <p className="stock-edit-brand-category-comps__muted">No sold comps</p>
                    )}
                    {editFormBrandCategorySaleComps.ready && editFormBrandCategorySaleComps.count > 0 && (
                      <div className="stock-edit-brand-category-comps__stack">
                        <div className="stock-edit-brand-category-comps__stat-line">
                          <span className="stock-edit-brand-category-comps__key">Avg</span>
                          <span className="stock-edit-brand-category-comps__val">
                            {formatCurrency(editFormBrandCategorySaleComps.avg ?? 0)}
                          </span>
                        </div>
                        <div className="stock-edit-brand-category-comps__stat-line">
                          <span className="stock-edit-brand-category-comps__key">Top</span>
                          <span className="stock-edit-brand-category-comps__val">
                            {formatCurrency(editFormBrandCategorySaleComps.max ?? 0)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {editingRowId ? (
                <div className="stock-new-entry-top-bar-edit-end">
                  <button
                    type="button"
                    className="delete-button stock-edit-row1-delete-btn"
                    onClick={handleDeleteClick}
                    disabled={creating || deleting}
                    aria-label="Delete stock item"
                    title="Remove this stock record"
                  >
                    <svg
                      className="stock-edit-row-1-delete-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              ) : null}
              </div>
              <div className="stock-new-entry-top-bar-row-2">
                <div className="stock-new-entry-top-bar-fields">
                  <label className="new-entry-field stock-new-entry-name-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={createForm.item_name}
                      onChange={(event) => handleCreateChange('item_name', event.target.value)}
                      placeholder="e.g. Barbour jacket"
                    />
                  </label>
                  <label className="new-entry-field stock-new-entry-department-field">
                    <span id="stock-form-department-label">Department</span>
                    <StockFormDropdown
                      value={createForm.department_id}
                      options={departments.map((d) => ({
                        value: String(d.id),
                        label: d.department_name,
                      }))}
                      onChange={(next) => handleCreateChange('department_id', next)}
                      disabled={departments.length === 0}
                      placeholder={
                        departments.length === 0 ? 'Loading departments…' : 'Select department…'
                      }
                      ariaLabelledBy="stock-form-department-label"
                    />
                  </label>
                  <div className="new-entry-field stock-new-entry-category-field" style={{ position: 'relative' }}>
                    <div className="new-entry-field-label-row">
                      <span id="stock-form-category-label">Category</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCategory(!showAddCategory);
                          setNewCategoryName('');
                        }}
                        disabled={!createForm.department_id?.trim()}
                        style={{
                          background: 'rgba(255, 214, 91, 0.15)',
                          border: '1px solid rgba(255, 214, 91, 0.3)',
                          borderRadius: '6px',
                          color: 'var(--neon-primary-strong)',
                          cursor: createForm.department_id?.trim() ? 'pointer' : 'not-allowed',
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: '24px',
                          height: '24px',
                          transition: 'all 0.2s ease',
                          opacity: createForm.department_id?.trim() ? 1 : 0.45,
                        }}
                        onMouseEnter={(e) => {
                          if (!createForm.department_id?.trim()) return;
                          e.currentTarget.style.background = 'rgba(255, 214, 91, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 214, 91, 0.15)';
                        }}
                        title={
                          createForm.department_id?.trim()
                            ? 'Add new category'
                            : 'Select a department first'
                        }
                      >
                        +
                      </button>
                    </div>
                    <StockFormDropdown
                      value={createForm.category_id}
                      options={categoriesForDepartment.map((category) => ({
                        value: String(category.id),
                        label: category.category_name,
                      }))}
                      onChange={(next) => handleCreateChange('category_id', next)}
                      disabled={!createForm.department_id?.trim()}
                      placeholder={
                        !createForm.department_id?.trim()
                          ? 'Select department first'
                          : 'Select category…'
                      }
                      ariaLabelledBy="stock-form-category-label"
                    />
                    {showAddCategory && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          marginTop: '4px',
                          padding: '8px',
                          background: 'rgba(255, 214, 91, 0.08)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 214, 91, 0.2)'
                        }}
                      >
                        <input
                          type="text"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddCategory();
                            } else if (e.key === 'Escape') {
                              setShowAddCategory(false);
                              setNewCategoryName('');
                            }
                          }}
                          placeholder="New category name..."
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 214, 91, 0.28)',
                            background: 'rgba(5, 4, 3, 0.88)',
                            color: 'var(--text-strong)',
                            fontSize: '0.9rem',
                            outline: 'none'
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleAddCategory}
                          disabled={savingCategory || !newCategoryName.trim()}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 214, 91, 0.3)',
                            background: savingCategory ? 'rgba(255, 214, 91, 0.2)' : 'rgba(255, 214, 91, 0.15)',
                            color: 'var(--neon-primary-strong)',
                            cursor: savingCategory ? 'not-allowed' : 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            opacity: savingCategory || !newCategoryName.trim() ? 0.6 : 1
                          }}
                        >
                          {savingCategory ? 'Saving...' : 'Add'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddCategory(false);
                            setNewCategoryName('');
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 120, 120, 0.3)',
                            background: 'rgba(255, 120, 120, 0.1)',
                            color: '#ffb0b0',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="new-entry-field stock-new-entry-brand-field" style={{ position: 'relative' }}>
                    <div className="new-entry-field-label-row">
                      <span id="stock-form-brand-label">Brand</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddBrand(!showAddBrand);
                          setNewBrandName('');
                        }}
                        disabled={!createForm.category_id?.trim()}
                        title={
                          createForm.category_id?.trim()
                            ? 'Add new brand'
                            : createForm.department_id?.trim()
                              ? 'Select a category first'
                              : 'Select a department first'
                        }
                        style={{
                          background: 'rgba(255, 214, 91, 0.15)',
                          border: '1px solid rgba(255, 214, 91, 0.3)',
                          borderRadius: '6px',
                          color: 'var(--neon-primary-strong)',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: '24px',
                          height: '24px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 214, 91, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 214, 91, 0.15)';
                        }}
                      >
                        +
                      </button>
                    </div>
                    <StockFormDropdown
                      value={createForm.brand_id}
                      options={brandsForBrandSelect.map((brand) => ({
                        value: String(brand.id),
                        label: brand.brand_name,
                      }))}
                      onChange={(next) => handleCreateChange('brand_id', next)}
                      disabled={!createForm.category_id?.trim()}
                      placeholder={
                        !createForm.department_id?.trim()
                          ? '-- Select department first --'
                          : !createForm.category_id?.trim()
                            ? '-- Select category first --'
                            : '-- No Brand --'
                      }
                      ariaLabelledBy="stock-form-brand-label"
                    />
                    {showAddBrand && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          marginTop: '4px',
                          padding: '8px',
                          background: 'rgba(255, 214, 91, 0.08)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 214, 91, 0.2)'
                        }}
                      >
                        <input
                          type="text"
                          value={newBrandName}
                          onChange={(e) => setNewBrandName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddBrand();
                            } else if (e.key === 'Escape') {
                              setShowAddBrand(false);
                              setNewBrandName('');
                            }
                          }}
                          placeholder="New brand name..."
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 214, 91, 0.28)',
                            background: 'rgba(5, 4, 3, 0.88)',
                            color: 'var(--text-strong)',
                            fontSize: '0.9rem',
                            outline: 'none'
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleAddBrand}
                          disabled={savingBrand || !newBrandName.trim()}
                          style={{
                            padding: '8px 16px',
                            background: 'var(--neon-primary-strong)',
                            color: '#000',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            opacity: savingBrand || !newBrandName.trim() ? 0.6 : 1
                          }}
                        >
                          {savingBrand ? 'Saving...' : 'Add'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddBrand(false);
                            setNewBrandName('');
                          }}
                          disabled={savingBrand}
                          style={{
                            padding: '8px 12px',
                            background: 'transparent',
                            color: 'rgba(255, 248, 226, 0.7)',
                            border: '1px solid rgba(255, 248, 226, 0.3)',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '1.2rem',
                            fontWeight: 600,
                            opacity: savingBrand ? 0.6 : 1
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                  <label className="new-entry-field stock-new-entry-size-field">
                    <span id="stock-form-size-label">Size</span>
                    <StockFormDropdown
                      value={createForm.category_size_id}
                      options={categorySizes.map((siz) => ({
                        value: String(siz.id),
                        label: siz.size_label,
                      }))}
                      onChange={(next) => handleCreateChange('category_size_id', next)}
                      disabled={!createForm.category_id?.trim() || categorySizesLoading}
                      placeholder={
                        !createForm.category_id?.trim()
                          ? 'Select category first'
                          : categorySizesLoading
                            ? 'Loading…'
                            : 'None'
                      }
                      ariaLabelledBy="stock-form-size-label"
                    />
                  </label>
                </div>
              </div>
            </div>
            {/* Row 2: purchase, date, sourced, tag */}
            <div className="stock-new-entry-row-prices">
              <label className="new-entry-field new-entry-field--stock-compact-price new-entry-field--stock-row2-equal">
                <span>Purchase Price (£)</span>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.purchase_price}
                  onChange={(event) => handleCreateChange('purchase_price', event.target.value)}
                  placeholder="e.g. 45.00"
                />
              </label>
              <label className="new-entry-field new-entry-field--stock-compact-date new-entry-field--stock-row2-equal">
                <span>Purchase Date</span>
                <DatePicker
                  selected={dateOnlyStringToLocalDate(createForm.purchase_date)}
                  onChange={(date) =>
                    handleCreateChange('purchase_date', localDateToDateOnlyString(date ?? null))
                  }
                  calendarStartDay={1}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select purchase date"
                  className="date-picker-input"
                  calendarClassName="date-picker-calendar"
                  wrapperClassName="date-picker-wrapper"
                />
              </label>
              <label className="new-entry-field new-entry-field--stock-row2-sourced new-entry-field--stock-row2-equal">
                <span id="stock-form-sourced-label">Sourced</span>
                <StockFormDropdown
                  value={createForm.sourced_location}
                  options={SOURCED_LOCATION_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onChange={(next) => handleCreateChange('sourced_location', next)}
                  placeholder="Select source…"
                  includeEmptyOption={false}
                  ariaLabelledBy="stock-form-sourced-label"
                />
              </label>
              <div className="new-entry-field stock-new-entry-tags-field new-entry-field--stock-row2-equal">
                <div className="new-entry-field-label-row">
                  <span id="stock-form-tags-label">Tag</span>
                </div>
                <div className="stock-brand-tag-dropdown" ref={stockTagDropdownRef}>
                  <button
                    type="button"
                    className={
                      'stock-brand-tag-dropdown-trigger' +
                      (!createForm.brand_id?.trim() ? ' stock-brand-tag-dropdown-trigger--disabled' : '')
                    }
                    aria-haspopup="listbox"
                    aria-expanded={stockTagDropdownOpen}
                    aria-labelledby="stock-form-tags-label"
                    disabled={!createForm.brand_id?.trim()}
                    onClick={() => {
                      if (!createForm.brand_id?.trim()) return;
                      setStockTagDropdownOpen((o) => !o);
                    }}
                  >
                    <span className="stock-brand-tag-dropdown-trigger-inner">
                      {selectedBrandTagImage?.public_url ? (
                        <img
                          src={selectedBrandTagImage.public_url}
                          alt=""
                          className="stock-brand-tag-dropdown-trigger-thumb"
                        />
                      ) : (
                        <span className="stock-brand-tag-dropdown-trigger-thumb stock-brand-tag-dropdown-trigger-thumb--empty" />
                      )}
                      <span className="stock-brand-tag-dropdown-trigger-text">
                        {!createForm.brand_id?.trim()
                          ? 'Select a brand first'
                          : brandTagImagesLoading
                            ? 'Loading tags…'
                            : brandTagImagesError
                              ? 'Could not load tags'
                              : brandTagImages.length === 0
                                ? 'No tags for this brand'
                                : selectedBrandTagImage
                                  ? (selectedBrandTagImage.caption?.trim() || `Tag #${selectedBrandTagImage.id}`)
                                  : 'Select tag…'}
                      </span>
                    </span>
                    <span className="stock-brand-tag-dropdown-chevron" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {stockTagDropdownOpen && createForm.brand_id?.trim() && (
                    <div
                      className="stock-brand-tag-dropdown-panel"
                      role="listbox"
                      aria-labelledby="stock-form-tags-label"
                    >
                      {brandTagImagesLoading ? (
                        <div className="stock-brand-tag-dropdown-row stock-brand-tag-dropdown-row--muted">
                          Loading…
                        </div>
                      ) : brandTagImagesError ? (
                        <div className="stock-brand-tag-dropdown-row stock-brand-tag-dropdown-row--muted" role="alert">
                          {brandTagImagesError}
                        </div>
                      ) : brandTagImages.length === 0 ? (
                        <div className="stock-brand-tag-dropdown-row stock-brand-tag-dropdown-row--muted">
                          No tag images for this brand.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="option"
                            className="stock-brand-tag-dropdown-row"
                            aria-selected={createForm.brand_tag_image_id === ''}
                            onClick={() => {
                              handleCreateChange('brand_tag_image_id', '');
                              setStockTagDropdownOpen(false);
                            }}
                          >
                            <span className="stock-brand-tag-dropdown-row-thumb stock-brand-tag-dropdown-row-thumb--none" />
                            <span>None</span>
                          </button>
                          {brandTagImages
                            .filter((t) => t.image_kind !== 'logo')
                            .map((t) => {
                              const picked = String(createForm.brand_tag_image_id) === String(t.id);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  role="option"
                                  className={
                                    'stock-brand-tag-dropdown-row' + (picked ? ' stock-brand-tag-dropdown-row--picked' : '')
                                  }
                                  aria-selected={picked}
                                  onClick={() => {
                                    handleCreateChange('brand_tag_image_id', String(t.id));
                                    setStockTagDropdownOpen(false);
                                  }}
                                >
                                  {t.public_url ? (
                                    <img
                                      src={t.public_url}
                                      alt=""
                                      className="stock-brand-tag-dropdown-row-thumb"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="stock-brand-tag-dropdown-row-thumb stock-brand-tag-dropdown-row-thumb--placeholder">
                                      ?
                                    </span>
                                  )}
                                  <span className="stock-brand-tag-dropdown-row-label">
                                    {t.caption?.trim() || `Tag #${t.id}`}
                                  </span>
                                </button>
                              );
                            })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Row 3: marketplace IDs; add-new also has write-off + save here. Edit: sale fields + platform + write-off + save on next row. */}
            <div
              className={
                editingRowId
                  ? 'stock-new-entry-row-ids stock-new-entry-row-ids--edit-marketplace'
                  : 'stock-new-entry-row-ids'
              }
            >
              <label className="new-entry-field stock-new-entry-id-field stock-new-entry-id-field--vinted">
                <span>Vinted ID</span>
                <input
                  type="text"
                  value={createForm.vinted_id}
                  onChange={(event) => handleCreateChange('vinted_id', event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="new-entry-field stock-new-entry-id-field stock-new-entry-id-field--ebay">
                <span>eBay ID</span>
                <input
                  type="text"
                  value={createForm.ebay_id}
                  onChange={(event) => handleCreateChange('ebay_id', event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="new-entry-field stock-new-entry-id-field stock-new-entry-id-field--depop">
                <span>Depop ID</span>
                <input
                  type="text"
                  value={createForm.depop_id}
                  onChange={(event) => handleCreateChange('depop_id', event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="new-entry-field stock-new-entry-id-field stock-new-entry-id-field--ebay-draft stock-new-entry-toggle-field">
                <span>eBay draft</span>
                <div className="stock-new-entry-bulky-input-skin">
                  <input
                    type="checkbox"
                    checked={createForm.ebay_draft}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, ebay_draft: event.target.checked }))
                    }
                    aria-label="eBay draft listing"
                  />
                </div>
              </label>
              <label className="new-entry-field stock-new-entry-id-field stock-new-entry-id-field--bulky stock-new-entry-toggle-field">
                <span>Bulky item</span>
                <div className="stock-new-entry-bulky-input-skin">
                  <input
                    type="checkbox"
                    checked={createForm.bulky_item}
                    onChange={(event) =>
                      setCreateForm((prev) => ({ ...prev, bulky_item: event.target.checked }))
                    }
                    aria-label="Bulky item"
                  />
                </div>
              </label>
              {!editingRowId && renderInventoryWriteOffField('new')}
              {!editingRowId && (
                <div className="stock-new-entry-row3-save stock-entry-mobile-save-bar">
                  <span className="stock-new-entry-row3-save-label-spacer" aria-hidden>
                    &nbsp;
                  </span>
                  <button
                    type="button"
                    className="stock-new-entry-save-circle stock-mobile-action-btn"
                    onClick={() => {
                      void handleCreateSubmit();
                    }}
                    disabled={creating || deleting}
                    aria-label={creating ? 'Saving' : 'Save item'}
                    title={creating ? 'Saving…' : 'Save'}
                  >
                    {creating ? (
                      <span className="stock-new-entry-save-spinner" aria-hidden />
                    ) : (
                      <svg
                        className="stock-new-entry-save-icon stock-mobile-action-btn-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                    )}
                    <span className="stock-mobile-action-btn-label">
                      {creating ? 'Saving…' : 'Save item'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {editingRowId && (
            <div className="stock-new-entry-edit-sale-section">
              <div className="stock-new-entry-row-edit-sale-platform-row">
                  <label className="new-entry-field new-entry-field--stock-compact-price">
                    <span>My Sales Price (£)</span>
                    <input
                      type="number"
                      step="0.01"
                      value={createForm.sale_price}
                      onChange={(event) => handleCreateChange('sale_price', event.target.value)}
                      placeholder="e.g. 95.00"
                      aria-label="My sales price or sale price"
                    />
                  </label>
                  <label className="new-entry-field new-entry-field--stock-compact-date">
                    <span>Sale Date</span>
                    <DatePicker
                      selected={dateOnlyStringToLocalDate(createForm.sale_date)}
                      onChange={(date) =>
                        handleCreateChange('sale_date', localDateToDateOnlyString(date ?? null))
                      }
                      calendarStartDay={1}
                      dateFormat="yyyy-MM-dd"
                      placeholderText="Select sale date"
                      className="date-picker-input"
                      calendarClassName="date-picker-calendar"
                      wrapperClassName="date-picker-wrapper"
                    />
                  </label>
                    <div
                      className="new-entry-field stock-new-entry-sold-platform-field stock-edit-sold-platform-field"
                      style={{ position: 'relative' }}
                      ref={soldPlatformDropdownRef}
                    >
                      <label
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          color: 'rgba(255, 248, 226, 0.7)',
                          letterSpacing: '0.05rem',
                          position: 'relative',
                          margin: 0,
                          width: '100%',
                        }}
                      >
                        <span>Sold Platform</span>
                        <div
                          className="new-entry-select stock-edit-sold-platform-trigger"
                          onClick={() => setShowSoldPlatformDropdown(!showSoldPlatformDropdown)}
                        >
                        {createForm.sold_platform ? (
                          (() => {
                            const getIconSrc = (platform: string) => {
                              if (platform === 'Vinted') return '/images/vinted-icon.svg';
                              if (platform === 'eBay') return '/images/ebay-icon.svg';
                              if (platform === 'Not Listed') return '/images/to-list-icon.svg';
                              return null;
                            };
                            const iconSrc = getIconSrc(createForm.sold_platform);
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                {iconSrc && (
                                  <img
                                    src={iconSrc}
                                    alt={`${createForm.sold_platform} icon`}
                                    style={{
                                      width: '12px',
                                      height: '12px',
                                      display: 'inline-block',
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                                {createForm.sold_platform}
                              </span>
                            );
                          })()
                        ) : (
                          <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.95rem' }}>
                            Select platform...
                          </span>
                        )}
                      </div>
                      {showSoldPlatformDropdown && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            marginTop: '4px',
                            background: 'rgba(5, 4, 3, 0.98)',
                            border: '1px solid rgba(255, 214, 91, 0.28)',
                            borderRadius: '16px',
                            padding: '8px',
                            zIndex: 1000,
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '10px 12px',
                              cursor: 'pointer',
                              borderRadius: '8px',
                              transition: 'background 0.2s ease',
                              background:
                                createForm.sold_platform === '' ? 'rgba(255, 214, 91, 0.1)' : 'transparent',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 214, 91, 0.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background =
                                createForm.sold_platform === '' ? 'rgba(255, 214, 91, 0.1)' : 'transparent';
                            }}
                            onClick={() => {
                              handleCreateChange('sold_platform', '');
                              setShowSoldPlatformDropdown(false);
                            }}
                          >
                            <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>
                              Select platform...
                            </span>
                          </div>
                          {PLATFORMS.map((platform) => {
                            const getIconSrc = (plat: string) => {
                              if (plat === 'Vinted') return '/images/vinted-icon.svg';
                              if (plat === 'eBay') return '/images/ebay-icon.svg';
                              if (plat === 'Not Listed') return '/images/to-list-icon.svg';
                              return null;
                            };
                            const iconSrc = getIconSrc(platform);
                            const isSelected = createForm.sold_platform === platform;
                            return (
                              <div
                                key={platform}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '10px 12px',
                                  cursor: 'pointer',
                                  borderRadius: '8px',
                                  transition: 'background 0.2s ease',
                                  background: isSelected ? 'rgba(255, 214, 91, 0.1)' : 'transparent',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(255, 214, 91, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isSelected
                                    ? 'rgba(255, 214, 91, 0.1)'
                                    : 'transparent';
                                }}
                                onClick={() => {
                                  handleCreateChange('sold_platform', platform);
                                  setShowSoldPlatformDropdown(false);
                                }}
                              >
                                {iconSrc && (
                                  <img
                                    src={iconSrc}
                                    alt={`${platform} icon`}
                                    style={{
                                      width: '12px',
                                      height: '12px',
                                      display: 'inline-block',
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                                <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>{platform}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </label>
                    </div>
                    <div
                      className="stock-edit-platform-write-off-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-hidden
                    />
                    {renderInventoryWriteOffField(String(editingRowId))}
                    <div className="stock-edit-save-in-row4 stock-entry-mobile-save-bar">
                      <span className="stock-edit-save-in-row4-label-spacer" aria-hidden>
                        &nbsp;
                      </span>
                      <div className="stock-edit-bottom-action-buttons">
                        <button
                          type="button"
                          className={`stock-edit-order-save-close-btn stock-mobile-action-btn${addingToOrder ? ' stock-edit-order-save-close-btn--busy' : ''}`}
                          onClick={() => {
                            void handleCreateSubmit({ addToOrdersAfterSave: true });
                          }}
                          disabled={creating || deleting || addingToOrder}
                          aria-label={
                            creating || addingToOrder
                              ? 'Saving and adding to orders'
                              : 'Add to order, save and close'
                          }
                          title={
                            creating || addingToOrder
                              ? 'Saving…'
                              : 'Add to order, save & close'
                          }
                        >
                          {creating || addingToOrder ? (
                            <span className="stock-edit-order-save-close-spinner" aria-hidden />
                          ) : (
                            <SaveAddToOrderCloseIcon className="stock-edit-order-save-close-icon stock-mobile-action-btn-icon" />
                          )}
                          <span className="stock-mobile-action-btn-label">
                            {creating || addingToOrder
                              ? 'Saving…'
                              : 'Add to order, save & close'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="save-button stock-edit-save-disk stock-mobile-action-btn"
                          onClick={() => {
                            void handleCreateSubmit();
                          }}
                          disabled={creating || deleting || addingToOrder}
                          aria-label={creating ? 'Saving changes' : 'Save changes'}
                          title={creating ? 'Saving…' : 'Save changes'}
                        >
                          {creating && !addingToOrder ? (
                            <span className="stock-edit-save-disk-spinner" aria-hidden />
                          ) : (
                            <svg
                              className="stock-edit-save-disk-icon stock-mobile-action-btn-icon"
                              xmlns="http://www.w3.org/2000/svg"
                              width="22"
                              height="22"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                              <polyline points="17 21 17 13 7 13 7 21" />
                              <polyline points="7 3 7 8 15 8" />
                            </svg>
                          )}
                          <span className="stock-mobile-action-btn-label">
                            {creating && !addingToOrder ? 'Saving…' : 'Save changes'}
                          </span>
                        </button>
                      </div>
                    </div>
              </div>
            </div>
          )}
        </div>
  ) : null;

  return (
    <div className={`stock-container ${showNewEntry ? 'editing-mode' : ''}`}>
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      {showNewEntry && (
        <div className="stock-entry-form-top">{stockEntryFormEl}</div>
      )}

      {showCreateInsteadOfEditConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => {
            if (!creating) {
              setShowCreateInsteadOfEditConfirm(false);
            }
          }}
        >
          <div
            className="new-entry-card"
            style={{
              maxWidth: '520px',
              width: '90%',
              margin: '0 auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                margin: '0 0 20px 0',
                color: 'var(--neon-primary-strong)',
                letterSpacing: '0.08rem'
              }}
            >
              Create new row?
            </h2>
            <p
              style={{
                color: 'rgba(255, 248, 226, 0.85)',
                marginBottom: '24px',
                fontSize: '1rem',
                lineHeight: 1.5
              }}
            >
              This form was opened to edit an existing item, but the saved row link is
              missing—often after a list refresh. Saving now will add a second stock row with the same details instead of
              updating the original. Cancel and reopen the item to update it, or confirm if
              you really want a new row.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="cancel-button"
                onClick={() => setShowCreateInsteadOfEditConfirm(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="button"
                className="save-button"
                onClick={() => {
                  void handleCreateSubmit(true);
                }}
                disabled={creating}
              >
                {creating ? 'Saving…' : 'Create new row anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWriteOffConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => setShowWriteOffConfirm(false)}
        >
          <div
            className="new-entry-card"
            style={{
              maxWidth: '500px',
              width: '90%',
              margin: '0 auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 20px 0', color: 'var(--neon-primary-strong)', letterSpacing: '0.08rem' }}>
              Mark as inventory write-off?
            </h2>
            <p style={{ color: 'rgba(255, 248, 226, 0.85)', marginBottom: '24px', fontSize: '1rem', lineHeight: 1.5 }}>
              This flags the item as <strong>unsellable</strong> (e.g. faults, damage, defects) for your records—a
              business write-off. You can clear it later by unchecking and saving.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="cancel-button" onClick={() => setShowWriteOffConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="save-button"
                onClick={() => {
                  setCreateForm((prev) => ({ ...prev, inventory_write_off: true }));
                  setShowWriteOffConfirm(false);
                }}
              >
                Yes, mark as write-off
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangeSkuModal && editingRowId != null && (
        <div
          className="stock-modal-backdrop"
          role="presentation"
          onClick={closeChangeSkuModal}
        >
          <div
            className="new-entry-card stock-change-sku-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-change-sku-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="stock-change-sku-title" className="stock-change-sku-title">
              Change SKU
            </h2>
            <p className="stock-change-sku-lead">
              Current sticker SKU: <strong>{editingRowId}</strong>. The item is copied to the new ID,
              then the old row is removed — an existing SKU cannot be overwritten.
            </p>

            {changeSkuError && (
              <div className="stock-change-sku-error" role="alert">
                {changeSkuError}
              </div>
            )}

            <div className="stock-change-sku-actions">
              <button
                type="button"
                className="stock-change-sku-btn stock-change-sku-btn--primary"
                disabled={changeSkuLoading || changeSkuNextId == null}
                onClick={() => {
                  if (changeSkuNextId != null) void applyStockSkuChange(changeSkuNextId);
                }}
              >
                {changeSkuLoading ? 'Updating…' : `Update ID To Latest${changeSkuNextId != null ? ` (${changeSkuNextId})` : ''}`}
              </button>
            </div>

            <label className="stock-change-sku-field">
              <span>Or enter a new SKU</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={changeSkuManualId}
                onChange={(e) => setChangeSkuManualId(e.target.value)}
                placeholder={changeSkuNextId != null ? String(changeSkuNextId) : 'e.g. 1093'}
                disabled={changeSkuLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const n = parseInt(changeSkuManualId.trim(), 10);
                    if (Number.isFinite(n)) void applyStockSkuChange(n);
                  }
                }}
              />
            </label>

            <div className="stock-change-sku-footer">
              <button
                type="button"
                className="cancel-button"
                onClick={closeChangeSkuModal}
                disabled={changeSkuLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="save-button"
                disabled={changeSkuLoading || !changeSkuManualId.trim()}
                onClick={() => {
                  const n = parseInt(changeSkuManualId.trim(), 10);
                  void applyStockSkuChange(n);
                }}
              >
                {changeSkuLoading ? 'Updating…' : 'Apply new SKU'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={handleDeleteCancel}
        >
          <div 
            className="new-entry-card"
            style={{
              maxWidth: '500px',
              width: '90%',
              margin: '0 auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 20px 0', color: 'var(--neon-primary-strong)', letterSpacing: '0.08rem' }}>
              Confirm Delete
            </h2>
            <p style={{ color: 'rgba(255, 248, 226, 0.85)', marginBottom: '24px', fontSize: '1rem' }}>
              Are you sure you want to delete this item? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cancel-button"
                onClick={handleDeleteCancel}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="stock-filters" ref={stockFiltersRef}>
        <div className="filter-group filter-actions">
          <button
            type="button"
            className="new-entry-button"
            onClick={() => {
              setShowNewEntry(true);
              setEditingRowId(null);
              setFormIntent('create');
              setShowCreateInsteadOfEditConfirm(false);
              resetCreateForm();
              setSuccessMessage(null);
              clearStockEditIdFromUrl();
              setTimeout(() => {
                scrollStockEntryFormIntoView(editFormRef.current);
              }, 200);
            }}
            disabled={showNewEntry || creating}
          >
            + Add
          </button>
        </div>

        <div className="filter-group search-group">
          <div className="search-input-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
            <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
              <input
                type="text"
                className="search-input"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => {
                  if (typeaheadSuggestions.length > 0) {
                    setShowTypeahead(true);
                  }
                }}
                onBlur={() => {
                  setTimeout(() => setShowTypeahead(false), 200);
                }}
                style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedMonth(String(now.getMonth() + 1));
                  setSelectedYear('all-time');
                  setSelectedWeek('off');
                  setViewMode('all');
                  setSelectedCategoryFilter('');
                  setUnsoldFilter('off');
                  loadStock();
                }}
                title="Clear all filters"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255, 120, 120, 0.15)',
                  border: '1px solid rgba(255, 120, 120, 0.3)',
                  borderRadius: '50%',
                  color: '#ffb0b0',
                  cursor: 'pointer',
                  padding: '0',
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  transition: 'all 0.2s ease',
                  lineHeight: '1'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 120, 120, 0.3)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(255, 120, 120, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 120, 120, 0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                ×
              </button>
            </div>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="filter-select"
              style={{
                minWidth: '140px',
                maxWidth: '140px',
                fontSize: '0.9rem',
                padding: '8px 12px',
                height: 'auto',
                flexShrink: 0
              }}
              title="Filter by category"
            >
              <option value="">All Categories</option>
              {uniqueCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {showTypeahead && typeaheadSuggestions.length > 0 && (
              <div className="typeahead-dropdown">
                {typeaheadSuggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="typeahead-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSearchTerm(suggestion);
                      setShowTypeahead(false);
                    }}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="filter-group">
          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="filter-select"
            title="Filter By Week"
          >
            <option value="off">Filter By Week</option>
            {availableWeeks.map((week) => (
              <option key={week.value} value={week.value}>
                {week.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <select
            value={selectedMonth}
            onChange={(event) => {
              setSelectedMonth(event.target.value);
              setSelectedWeek('off'); // Reset week when month changes
            }}
            className="filter-select"
          >
            {MONTHS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <select
            value={selectedYear}
            onChange={(event) => {
              setSelectedYear(event.target.value);
              setSelectedWeek('off'); // Reset week when year changes
            }}
            className="filter-select"
          >
            <option value="last-30-days">Last 30 Days</option>
            <option value="all-time">All Time</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group view-group">
          <select
            value={viewMode}
            onChange={(event) =>
              setViewMode(
                event.target.value as
                  | 'all'
                  | 'active-listing'
                  | 'sales'
                  | 'listing'
                  | 'to-list'
                  | 'list-on-vinted'
                  | 'list-on-ebay'
                  | 'inventory-write-off'
              )
            }
            className="filter-select"
          >
            <option value="all">All</option>
            <option value="active-listing">Active</option>
            <option value="sales">Sold Items</option>
            <option value="listing">Add This Month</option>
            <option value="to-list">To List</option>
            <option value="list-on-vinted">To List On Vinted</option>
            <option value="list-on-ebay">To List On eBay</option>
            <option value="inventory-write-off">Inventory write-off</option>
          </select>
          <button
            type="button"
            className="stock-refresh-icon-button"
            onClick={() => loadStock()}
            title="Refresh stock list"
            aria-label="Refresh stock list"
          >
            ↻
          </button>
        </div>

        <div className="filter-group unsold-filter-group">
          <select
            value={unsoldFilter}
            onChange={(event) => {
              const value = event.target.value as 'off' | '3' | '6' | '12';
              setUnsoldFilter(value);
              
              // Clear other filters when a non-"Off" option is selected
              if (value !== 'off') {
                setSearchTerm('');
                setSelectedMonth(String(now.getMonth() + 1));
                setSelectedYear(String(now.getFullYear()));
                setSelectedWeek('off');
                setViewMode('all');
                setSelectedCategoryFilter('');
              }
            }}
            className="filter-select unsold-filter-select"
          >
            <option value="off">Unsold Filter</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
          </select>
        </div>
      </div>

      <section className="stock-summary">
        <div className="summary-card summary-card-next-sku">
          <span className="summary-label">Next SKU</span>
          <span className="summary-value">{nextSku}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Stock Purchases</span>
          <span className="summary-value">{formatCurrency(totals.purchase)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Sales</span>
          <span className="summary-value">{formatCurrency(totals.sale)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Profit</span>
          <span className={`summary-value ${totals.profit >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(totals.profit)}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Records</span>
          <span className="summary-value">{stockTotalCount.toLocaleString()}</span>
        </div>
      </section>

      {/* Desktop Table View + mobile cards — unmount while editing to avoid re-rendering thousands of rows on each keystroke */}
      {!showNewEntry && (
        <>
      <div className="table-wrapper">
        <table className="stock-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'id' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('id')}
                >
                  SKU <span className="sort-indicator">{resolveSortIndicator('id')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'item_name' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('item_name')}
                >
                  Item <span className="sort-indicator">{resolveSortIndicator('item_name')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'category_id' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('category_id')}
                >
                  Category <span className="sort-indicator">{resolveSortIndicator('category_id')}</span>
                </button>
              </th>
              <th scope="col">Department</th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_price' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_price')}
                >
                  Purchase Price <span className="sort-indicator">{resolveSortIndicator('purchase_price')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_date' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_date')}
                >
                  Purchase Date <span className="sort-indicator">{resolveSortIndicator('purchase_date')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'sale_date' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('sale_date')}
                  title="Sort by sale date"
                >
                  Sold <span className="sort-indicator">{resolveSortIndicator('sale_date')}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-state">
                  No stock records found.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditingRow(row);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textDecorationColor: 'rgba(255, 214, 91, 0.5)',
                        textUnderlineOffset: '2px',
                        padding: 0,
                        font: 'inherit',
                        textAlign: 'left',
                        width: '100%'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.textDecorationColor = 'rgba(255, 214, 91, 0.8)';
                        e.currentTarget.style.color = 'var(--neon-primary-strong)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.textDecorationColor = 'rgba(255, 214, 91, 0.5)';
                        e.currentTarget.style.color = 'inherit';
                      }}
                    >
                      {renderCellContent(row, 'item_name')}
                    </button>
                  </td>
                  <td>{renderCellContent(row, 'category_id')}</td>
                  <td>{departmentNameForRow(row, categories, departments)}</td>
                  <td>{renderCellContent(row, 'purchase_price', formatCurrency)}</td>
                  <td>
                    {renderCellContent(
                      row,
                      'purchase_date',
                      (val) => formatDate(val as Nullable<string>),
                      true
                    )}
                  </td>
                  <td className={soldColumnClass(row)}>
                    <div className="stock-sold-cell-inner">
                      <span className="stock-sold-line">
                        {stockSaleDatePresent(row)
                          ? formatDate(row.sale_date as string)
                          : '—'}
                      </span>
                      <span className="stock-sold-line stock-sold-line--price">
                        {stockSalePriceEmpty(row)
                          ? '—'
                          : formatCurrency(row.sale_price)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stockTotalPages > 1 ? (
        <div className="stock-pagination stock-pagination--shared" aria-label="Stock list pagination">
          <button
            type="button"
            className="stock-pagination-button"
            disabled={loading || stockPage <= 1}
            onClick={() => goToStockPage(stockPage - 1)}
          >
            Previous
          </button>
          <span className="stock-pagination-status">
            Page {stockPage} of {stockTotalPages}
            <span className="stock-pagination-count">
              ({stockTotalCount.toLocaleString()} records)
            </span>
          </span>
          <button
            type="button"
            className="stock-pagination-button"
            disabled={loading || stockPage >= stockTotalPages}
            onClick={() => goToStockPage(stockPage + 1)}
          >
            Next
          </button>
        </div>
      ) : null}

      {/* Mobile Card View */}
      <div className="stock-cards-wrapper">
        {!loading && rows.length === 0 && (
          <div className="stock-empty-state">
            No stock records found.
          </div>
        )}
        {rows.map((row) => {
          const categoryName = categories.find(c => c.id === row.category_id)?.category_name || '—';
          const brandName = brands.find(b => b.id === row.brand_id)?.brand_name || '—';
          const deptName = departmentNameForRow(row, categories, departments);

          return (
            <div key={row.id} className="stock-card">
              <div className="stock-card-header">
                <span className="stock-card-sku"><span className="sku-label">SKU: </span>{row.id}</span>
              </div>
              <div className="stock-card-body">
                <button
                  type="button"
                  className="stock-card-title stock-card-link"
                  onClick={(event) => {
                    event.stopPropagation();
                    startEditingRow(row);
                  }}
                >
                  {renderCellContent(row, 'item_name')}
                </button>
                {categoryName !== '—' && (
                  <div className="stock-card-field">
                    <span className="stock-card-label">Category</span>
                    <span className="stock-card-value">{categoryName}</span>
                  </div>
                )}
                {deptName !== '—' && (
                  <div className="stock-card-field">
                    <span className="stock-card-label">Department</span>
                    <span className="stock-card-value">{deptName}</span>
                  </div>
                )}
                {brandName !== '—' && (
                  <div className="stock-card-field">
                    <span className="stock-card-label">Brand</span>
                    <span className="stock-card-value">{brandName}</span>
                  </div>
                )}
                <div className="stock-card-field">
                  <span className="stock-card-label">Purchase Price</span>
                  <span className="stock-card-value">{renderCellContent(row, 'purchase_price', formatCurrency)}</span>
                </div>
                <div className="stock-card-field">
                  <span className="stock-card-label">Sold</span>
                  <span className={`stock-card-value ${soldColumnClass(row)}`}>
                    <span className="stock-sold-cell-inner stock-sold-cell-inner--card">
                      <span className="stock-sold-line">
                        {stockSaleDatePresent(row)
                          ? formatDate(row.sale_date as string)
                          : '—'}
                      </span>
                      <span className="stock-sold-line stock-sold-line--price">
                        {stockSalePriceEmpty(row)
                          ? '—'
                          : formatCurrency(row.sale_price)}
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
};

export default Stock;
