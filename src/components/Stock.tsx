import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { pingDatabase } from '../utils/dbPing';
import { getApiBase } from '../utils/apiBase';
import './Stock.css';

const API_BASE = getApiBase();

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
}

interface Brand {
  id: number;
  brand_name: string;
}

interface Category {
  id: number;
  category_name: string;
}

interface BrandTagImageRow {
  id: number;
  brand_id: number;
  public_url?: string | null;
  caption?: string | null;
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
}

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

const formatDate = (value: Nullable<string>) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

function soldPlatformIsEbayStock(p: string | null | undefined): boolean {
  const t = p?.trim();
  return t === 'eBay' || t?.toLowerCase() === 'ebay';
}

function soldPlatformIsVintedStock(p: string | null | undefined): boolean {
  const t = p?.trim();
  return t === 'Vinted' || t?.toLowerCase() === 'vinted';
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


const normalizeDateInput = (value: Nullable<string>) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const iso = date.toISOString();
  return iso.slice(0, 10);
};

const stringToDate = (value: Nullable<string>) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateToIsoString = (value: Date | null) => {
  if (!value) {
    return '';
  }
  const iso = value.toISOString();
  return iso.slice(0, 10);
};

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

function buildStockListingImageBackgroundPrompt(brandName: string): string {
  const brand =
    brandName.trim() && brandName.trim() !== '(not set)'
      ? brandName.trim()
      : '(specify the clothing brand — not set on this stock item)';
  return [
    'I will upload a product photo of a clothing item. Use my upload as the source image.',
    '',
    'Prepare the image to improve online sales:',
    '',
    '1. Remove the background so the garment is cleanly cut out.',
    '2. Add a light, neutral grey gradient background, slightly brighter toward the centre (focal emphasis in the middle).',
    '3. Keep clear space on both sides of the item; centre the garment if needed for a balanced composition.',
    `4. Add the **${brand}** clothing brand logo.`,
    '   - Use a thin, tall (vertical) lock-up rather than a wide horizontal logo if multiple layouts exist.',
    '   - The logo must be at most **12% of the total image height**.',
    '5. Make the clothing item as large as possible within the frame using the remaining space after the logo and margins — the product should dominate; the logo stays secondary.',
    '',
    'Deliver one polished listing-ready image suitable for marketplaces.',
  ].join('\n');
}

/** Parse £ / comma / space from money text fields; returns NaN if empty/invalid. */
function parseStockMoneyInput(raw: string | undefined | null): number {
  const s = String(raw ?? '')
    .trim()
    .replace(/[£,\s]/g, '');
  if (s === '') return NaN;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Preserve numeric 0 from the API; avoid falsy checks that drop 0. */
function stockDbNumberToFormString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

const Stock: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [selectedYear, setSelectedYear] = useState<string>('last-30-days');
  const [selectedWeek, setSelectedWeek] = useState<string>('off');
  const [viewMode, setViewMode] = useState<'all' | 'active-listing' | 'sales' | 'listing' | 'to-list' | 'list-on-vinted' | 'list-on-ebay'>('all');
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    item_name: '',
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
    sourced_location: 'charity_shop'
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
  const [selectedDataRow, setSelectedDataRow] = useState<StockRow | null>(null);
  const [selectedRowElement, setSelectedRowElement] = useState<HTMLElement | null>(null);
  const [isDataPanelClosing, setIsDataPanelClosing] = useState(false);
  const [offerPrice, setOfferPrice] = useState<string>('');
  const [promotedFee, setPromotedFee] = useState<string>('10');
  const [showSoldPlatformDropdown, setShowSoldPlatformDropdown] = useState(false);
  const soldPlatformDropdownRef = useRef<HTMLDivElement>(null);
  /** True when the row being edited is already in the Orders list (server `orders` table). */
  const [editingRowInOrders, setEditingRowInOrders] = useState(false);
  /** True while POST /api/orders is in flight — button shows disabled / pending styling. */
  const [addingToOrder, setAddingToOrder] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [savingBrand, setSavingBrand] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCreateInsteadOfEditConfirm, setShowCreateInsteadOfEditConfirm] = useState(false);
  /** Tracks whether the open form was started from row edit (+ Add sets 'create'). Used to catch accidental POST after edit context was lost. */
  const [formIntent, setFormIntent] = useState<'create' | 'edit'>('create');
  const [deleting, setDeleting] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);
  const [visibleItemsCount, setVisibleItemsCount] = useState(20);
  const cardsWrapperRef = useRef<HTMLDivElement>(null);

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

  // Scroll to edit form when it opens on mobile
  useEffect(() => {
    if (showNewEntry && editingRowId && editFormRef.current) {
      const isMobile = window.innerWidth <= 768;
      const scrollToForm = () => {
        if (editFormRef.current) {
          editFormRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: isMobile ? 'center' : 'start',
            inline: 'nearest'
          });
          // Additional scroll adjustment for mobile to account for fixed headers
          if (isMobile) {
            setTimeout(() => {
              const rect = editFormRef.current?.getBoundingClientRect();
              if (rect && rect.top < 120) {
                window.scrollBy({
                  top: rect.top - 120,
                  behavior: 'smooth'
                });
              }
            }, 100);
          }
        }
      };
      // Delay to ensure DOM has updated
      const timeoutId = setTimeout(scrollToForm, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [showNewEntry, editingRowId]);

  const loadStock = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/stock`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
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
      // Verify we're using the actual database id values
      if (data.rows && data.rows.length > 0) {
        console.log('Stock data loaded from API:', data.rows.length, 'rows');
        console.log('Sample row with database id:', data.rows[0]?.id, data.rows[0]);
        console.log('Sample row vinted_id:', data.rows[0]?.vinted_id);
        console.log('Sample row ebay_id:', data.rows[0]?.ebay_id);
        // Find row with specific ebay_id for debugging
        const testRow = data.rows.find(r => r.ebay_id && String(r.ebay_id).includes('297907143894'));
        if (testRow) {
          console.log('Found row with ebay_id 297907143894:', testRow);
        }
      }
      const nextRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(nextRows);
      // Never clear editingRowId on refresh — that left the form open while Save switched to POST (duplicate rows).
      setEditingRowId((prevId) => {
        if (prevId === null) return null;
        const stillThere = nextRows.some((r) => Number(r.id) === Number(prevId));
        return stillThere ? prevId : null;
      });
    } catch (err: any) {
      console.error('Stock load error:', err);
      // Provide more helpful error message for network errors
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load stock data');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

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
        setBrands(Array.isArray(data.rows) ? data.rows : []);
      }
    } catch (err) {
      console.error('Failed to load brands:', err);
    }
  };

  useEffect(() => {
    loadStock();
    loadCategories();
    loadBrands();
  }, []);

  useEffect(() => {
    pingDatabase();
    const intervalId = window.setInterval(pingDatabase, 4 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Reset visible items count when filters change
  useEffect(() => {
    setVisibleItemsCount(20);
  }, [selectedMonth, selectedYear, selectedWeek, viewMode, searchTerm, unsoldFilter, selectedCategoryFilter]);

  // Handle editId query parameter from Orders page
  useEffect(() => {
    const editIdParam = searchParams.get('editId');
    if (editIdParam && rows.length > 0 && !loading && !editingRowId && !creating) {
      const editId = parseInt(editIdParam, 10);
      if (!isNaN(editId)) {
        const rowToEdit = rows.find(row => row.id === editId);
        if (rowToEdit) {
          // Set editing state and form data
          setFormIntent('edit');
          setEditingRowId(rowToEdit.id);
          setCreateForm({
            item_name: rowToEdit.item_name ?? '',
            category_id: rowToEdit.category_id ? String(rowToEdit.category_id) : '',
            purchase_price: stockDbNumberToFormString(rowToEdit.purchase_price),
            purchase_date: normalizeDateInput(rowToEdit.purchase_date ?? ''),
            sale_date: normalizeDateInput(rowToEdit.sale_date ?? ''),
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
          });
          setShowNewEntry(true);
          setSuccessMessage(null);
          // Remove the query parameter from URL
          setSearchParams({});
          
          // Scroll to edit form after DOM updates
          setTimeout(() => {
            if (editFormRef.current) {
              const isMobile = window.innerWidth <= 768;
              editFormRef.current.scrollIntoView({ 
                behavior: 'smooth', 
                block: isMobile ? 'center' : 'start',
                inline: 'nearest'
              });
              if (isMobile) {
                setTimeout(() => {
                  const rect = editFormRef.current?.getBoundingClientRect();
                  if (rect && rect.top < 120) {
                    window.scrollBy({
                      top: rect.top - 120,
                      behavior: 'smooth'
                    });
                  }
                }, 100);
              }
            }
          }, 150);
        }
      }
    }
  }, [rows, loading, searchParams, editingRowId, creating, setSearchParams]);

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
          const ok = rows.some((r) => String(r.id) === String(prev.brand_tag_image_id));
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

    const categoryName = newCategoryName.trim();
    
    // Check if category already exists (case-insensitive)
    const categoryExists = categories.some(c => c.category_name.toLowerCase() === categoryName.toLowerCase());
    if (categoryExists) {
      setError('Category already exists');
      setNewCategoryName('');
      setShowAddCategory(false);
      return;
    }

    setSavingCategory(true);
    setError(null);
    try {
      console.log('Adding category:', categoryName);
      const response = await fetch(`${API_BASE}/api/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category_name: categoryName }),
      });

      console.log('Category API response status:', response.status);

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
      console.log('Category created successfully:', data);
      
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

    const brandName = newBrandName.trim();
    
    // Check if brand already exists (case-insensitive)
    const brandExists = brands.some(b => b.brand_name.toLowerCase() === brandName.toLowerCase());
    if (brandExists) {
      setError('Brand already exists');
      setNewBrandName('');
      setShowAddBrand(false);
      return;
    }

    setSavingBrand(true);
    setError(null);
    try {
      console.log('Adding brand:', brandName);
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brand_name: brandName }),
      });

      console.log('Brand API response status:', response.status);

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
      console.log('Brand created successfully:', data);
      
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
    const yearSet = new Set<number>([now.getFullYear()]);
    rows.forEach((row) => {
      const purchaseDate = row.purchase_date ? new Date(row.purchase_date) : null;
      if (purchaseDate && !Number.isNaN(purchaseDate.getTime())) {
        yearSet.add(purchaseDate.getFullYear());
      }

      const saleDate = row.sale_date ? new Date(row.sale_date) : null;
      if (saleDate && !Number.isNaN(saleDate.getTime())) {
        yearSet.add(saleDate.getFullYear());
      }
    });

    return Array.from(yearSet)
      .sort((a, b) => b - a)
      .map((year) => String(year));
  }, [rows, now]);

  useEffect(() => {
    if (availableYears.length === 0) {
      return;
    }

    // If selectedYear is not "all-time", "last-30-days", and not in available years, reset to last-30-days
    if (selectedYear !== 'all-time' && selectedYear !== 'last-30-days' && !availableYears.includes(selectedYear) && selectedYear !== currentYear) {
      setSelectedYear('last-30-days');
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

  const matchesMonthYear = (dateValue: Nullable<string>, month: string, year: string) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    return (
      String(date.getMonth() + 1) === month &&
      String(date.getFullYear()) === year
    );
  };

  // Check if a date falls within the last 30 days
  const matchesLast30Days = (dateValue: Nullable<string>) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0); // Start of 30 days ago

    return date >= thirtyDaysAgo && date <= today;
  };

  // Check if a date falls within the selected week
  const matchesWeek = (dateValue: Nullable<string>, weekStartDate: Date, weekEndDate: Date) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    // Set time to midnight for accurate comparison
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const start = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
    const end = new Date(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());

    return checkDate >= start && checkDate <= end;
  };

  const uniqueItemNames = useMemo(() => {
    const items = new Set<string>();
    rows.forEach((row) => {
      if (row.item_name && row.item_name.trim()) {
        items.add(row.item_name.trim());
      }
    });
    return Array.from(items).sort();
  }, [rows]);

  const uniqueCategories = useMemo(() => {
    // Get unique category names from the categories list based on category_id in rows
    const categoryIds = new Set<number>();
    rows.forEach((row) => {
      if (row.category_id) {
        categoryIds.add(row.category_id);
      }
    });
    return categories
      .filter(cat => categoryIds.has(cat.id))
      .map(cat => cat.category_name)
      .sort();
  }, [rows, categories]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setTypeaheadSuggestions([]);
      setShowTypeahead(false);
      return;
    }

    const term = searchTerm.toLowerCase().trim();
    const matches = uniqueItemNames
      .filter((name) => name.toLowerCase().includes(term))
      .slice(0, 10);

    setTypeaheadSuggestions(matches);
    setShowTypeahead(matches.length > 0);
  }, [searchTerm, uniqueItemNames]);

  const filteredRows = useMemo(() => {
    if (!rows.length) {
      return [];
    }

    let filtered = rows;

    // Apply unsold filter if active (overrides other filters)
    if (unsoldFilter !== 'off') {
      const today = new Date();
      
      filtered = filtered.filter((row) => {
        // Must not be sold (no sale_date)
        if (row.sale_date) {
          return false;
        }

        // Must have a purchase_date
        if (!row.purchase_date) {
          return false;
        }

        const purchaseDate = new Date(row.purchase_date);
        if (Number.isNaN(purchaseDate.getTime())) {
          return false;
        }

        const daysSincePurchase = Math.floor((today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (unsoldFilter === '3') {
          return daysSincePurchase >= 90; // 3 months = ~90 days
        } else if (unsoldFilter === '6') {
          return daysSincePurchase >= 180; // 6 months = ~180 days
        } else if (unsoldFilter === '12') {
          return daysSincePurchase >= 365; // 12 months = ~365 days
        }

        return false;
      });

      // Apply search globally even with unsold filter
      if (searchTerm.trim()) {
        const searchLower = searchTerm.toLowerCase().trim();
        const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);
        filtered = filtered.filter((row) => {
          const itemName = row.item_name ? String(row.item_name).toLowerCase() : '';
          const vintedId = row.vinted_id ? String(row.vinted_id).toLowerCase() : '';
          const ebayId = row.ebay_id ? String(row.ebay_id).toLowerCase() : '';
          const skuId = String(row.id).toLowerCase();
          
          // For item name: match if ALL words are present (AND logic, order doesn't matter)
          const itemNameMatches = searchWords.length > 0 && searchWords.every(word => itemName.includes(word));
          
          // For IDs: exact match (for precise ID searches)
          const idMatches = vintedId.includes(searchLower) || ebayId.includes(searchLower) || skuId.includes(searchLower);
          
          return itemNameMatches || idMatches;
        });
      }

      return filtered;
    }

    // If search term exists, search globally first (ignore date/viewMode filters)
    // Then apply other filters (category) to narrow down
    const hasSearchTerm = searchTerm.trim();
    
    if (hasSearchTerm) {
      // First, apply global search across all rows
      const searchLower = searchTerm.toLowerCase().trim();
      const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);
      filtered = filtered.filter((row) => {
        const itemName = row.item_name ? String(row.item_name).toLowerCase() : '';
        const vintedId = row.vinted_id ? String(row.vinted_id).toLowerCase() : '';
        const ebayId = row.ebay_id ? String(row.ebay_id).toLowerCase() : '';
        const skuId = String(row.id).toLowerCase();
        
        // For item name: match if ALL words are present (AND logic, order doesn't matter)
        const itemNameMatches = searchWords.length > 0 && searchWords.every(word => itemName.includes(word));
        
        // For IDs: exact match (for precise ID searches)
        const idMatches = vintedId.includes(searchLower) || ebayId.includes(searchLower) || skuId.includes(searchLower);
        
        const matches = itemNameMatches || idMatches;
        if (searchLower && (row.ebay_id || row.vinted_id)) {
          console.log('Search debug:', { 
            searchTerm: searchLower, 
            searchWords,
            ebayId, 
            vintedId, 
            itemName, 
            skuId,
            rowId: row.id,
            itemNameMatches,
            idMatches,
            matches 
          });
        }
        return matches;
      });

      // Then apply category filter to narrow down search results
      if (selectedCategoryFilter) {
        // Find the category_id for the selected category name
        const selectedCategory = categories.find(cat => cat.category_name === selectedCategoryFilter);
        if (selectedCategory) {
          filtered = filtered.filter((row) => row.category_id === selectedCategory.id);
        }
      }

      // Search results are global - don't apply date/viewMode filters
      return filtered;
    }

    // No search term - apply all filters normally
    return filtered.filter((row) => {
      // Handle special view modes for listing filters
      if (viewMode === 'all') {
        // Show everything - no filtering by view mode
      } else if (viewMode === 'active-listing') {
        // Show items that are actively for sale: have purchase_date but no sale_date
        if (!row.purchase_date || row.sale_date) {
          return false;
        }
      } else if (viewMode === 'list-on-vinted') {
        // Only show unsold items (sale_price is null/empty) where vinted_id is null or empty (not listed on Vinted)
        const isSold = row.sale_price !== null && row.sale_price !== undefined && row.sale_price !== '' && Number(row.sale_price) > 0;
        if (isSold) {
          return false;
        }
        if (row.vinted_id && row.vinted_id.trim()) {
          return false;
        }
      } else if (viewMode === 'list-on-ebay') {
        // Only show unsold items (sale_price is null/empty) where ebay_id is null or empty (not listed on eBay)
        const isSold = row.sale_price !== null && row.sale_price !== undefined && row.sale_price !== '' && Number(row.sale_price) > 0;
        if (isSold) {
          return false;
        }
        if (row.ebay_id && row.ebay_id.trim()) {
          return false;
        }
      } else if (viewMode === 'to-list') {
        // Only show unsold items (sale_price is null/empty)
        const isSold = row.sale_price !== null && row.sale_price !== undefined && row.sale_price !== '' && Number(row.sale_price) > 0;
        if (isSold) {
          return false;
        }
        
        // Show items where category is "To List" OR (vinted_id is null/empty AND ebay_id is null/empty)
        const toListCategory = categories.find(cat => cat.category_name === 'To List');
        const hasCategoryToList = toListCategory && row.category_id === toListCategory.id;
        const notListedAnywhere = (!row.vinted_id || !row.vinted_id.trim()) && (!row.ebay_id || !row.ebay_id.trim());
        
        if (!hasCategoryToList && !notListedAnywhere) {
          return false;
        }
      }

      let dateMatches = false;
      
      // If week filter is active, use week-based filtering
      if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          const { startDate, endDate } = selectedWeekData;
          
          if (viewMode === 'all') {
            // Filter by either sold date or purchase date falling within the selected week
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate) || matchesWeek(row.sale_date, startDate, endDate);
          } else if (viewMode === 'active-listing') {
            // Show all items listed (purchased) that week but not sold
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate);
          } else if (viewMode === 'sales') {
            // Filter by sold date only
            dateMatches = matchesWeek(row.sale_date, startDate, endDate);
          } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list') {
            // Filter by purchase date only
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate);
          }
        }
      } else {
        // Use month/year filtering when week is not selected
        if (selectedYear === 'all-time') {
          // Show all items regardless of year
          dateMatches = true;
        } else if (selectedYear === 'last-30-days') {
          // Show items from last 30 days
          if (viewMode === 'all') {
            // For "all" view, check both purchase_date and sale_date
            dateMatches = matchesLast30Days(row.purchase_date) || matchesLast30Days(row.sale_date);
          } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list' || viewMode === 'active-listing') {
            dateMatches = matchesLast30Days(row.purchase_date);
          } else {
            dateMatches = matchesLast30Days(row.sale_date);
          }
        } else if (viewMode === 'all') {
          // For "all" view, check both purchase_date and sale_date
          dateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear) || matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
        } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list' || viewMode === 'active-listing') {
          dateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear);
        } else {
          dateMatches = matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
        }
      }

      if (!dateMatches) {
        return false;
      }

      // Apply category filter
      if (selectedCategoryFilter) {
        const selectedCategory = categories.find(cat => cat.category_name === selectedCategoryFilter);
        if (selectedCategory && row.category_id !== selectedCategory.id) {
          return false;
        }
      }

      return true;
    });
  }, [rows, selectedMonth, selectedYear, selectedWeek, viewMode, searchTerm, unsoldFilter, selectedCategoryFilter, availableWeeks, categories]);

  const computeDataPanelMetrics = (row: StockRow) => {
    const purchase = row.purchase_price !== null && row.purchase_price !== undefined
      ? Number(row.purchase_price)
      : NaN;
    
    // For unsold items, show 0 for sale price
    const sale = row.sale_price !== null && row.sale_price !== undefined
      ? Number(row.sale_price)
      : row.sale_date === null || row.sale_date === undefined
        ? 0
        : NaN;

    // For unsold items, profit is negative of purchase price (or 0 if no purchase price)
    const profit =
      row.net_profit !== null && row.net_profit !== undefined
        ? Number(row.net_profit)
        : !Number.isNaN(purchase) && !Number.isNaN(sale)
          ? sale - purchase
          : !Number.isNaN(purchase) && (row.sale_date === null || row.sale_date === undefined)
            ? -purchase
            : NaN;

    let profitMultiple: string | null = null;
    if (!Number.isNaN(purchase) && purchase > 0) {
      if (!Number.isNaN(sale) && sale > 0) {
        const multiple = sale / purchase;
        profitMultiple = `${multiple.toFixed(2)}x`;
      } else if (row.sale_date === null || row.sale_date === undefined) {
        // Unsold item - show 0x
        profitMultiple = '0.00x';
      }
    }

    let daysForSale: number | null = null;
    if (row.purchase_date) {
      if (row.sale_date) {
        // Sold item - calculate days between purchase and sale
        const purchaseDate = new Date(row.purchase_date);
        const saleDate = new Date(row.sale_date);
        if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(saleDate.getTime())) {
          const diffMs = saleDate.getTime() - purchaseDate.getTime();
          daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }
      } else {
        // Unsold item - calculate days from purchase to now
        const purchaseDate = new Date(row.purchase_date);
        if (!Number.isNaN(purchaseDate.getTime())) {
          const diffMs = Date.now() - purchaseDate.getTime();
          daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }
      }
    }

    return {
      purchase,
      sale,
      profit,
      profitMultiple,
      daysForSale
    };
  };

  const nextSku = useMemo(() => {
    if (rows.length === 0) {
      return 1;
    }
    const maxId = Math.max(...rows.map(row => row.id));
    return maxId + 1;
  }, [rows]);

  const totals = useMemo(() => {
    // Calculate stats based on date filters, not filteredRows
    // This ensures purchases and sales are calculated independently based on their respective dates
    
    let totalPurchase = 0;
    let totalSales = 0;

    rows.forEach((row) => {
      // Check if purchase_date matches the current filters
      let purchaseDateMatches = false;
      if (selectedYear === 'all-time') {
        purchaseDateMatches = true; // Show all if "all-time" is selected
      } else if (selectedYear === 'last-30-days') {
        purchaseDateMatches = matchesLast30Days(row.purchase_date);
      } else if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          purchaseDateMatches = matchesWeek(row.purchase_date, selectedWeekData.startDate, selectedWeekData.endDate);
        }
      } else {
        purchaseDateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear);
      }

      // Check if sale_date matches the current filters
      let saleDateMatches = false;
      if (selectedYear === 'all-time') {
        saleDateMatches = true; // Show all if "all-time" is selected
      } else if (selectedYear === 'last-30-days') {
        saleDateMatches = matchesLast30Days(row.sale_date);
      } else if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          saleDateMatches = matchesWeek(row.sale_date, selectedWeekData.startDate, selectedWeekData.endDate);
        }
      } else {
        saleDateMatches = matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
      }

      // Sum purchases based on purchase_date matching filters
      if (purchaseDateMatches && row.purchase_price) {
        const purchase = Number(row.purchase_price);
        if (!Number.isNaN(purchase)) {
          totalPurchase += purchase;
        }
      }

      // Sum sales based on sale_date matching filters
      if (saleDateMatches && row.sale_price) {
        const sale = Number(row.sale_price);
        if (!Number.isNaN(sale)) {
          totalSales += sale;
        }
      }
    });

    return {
      purchase: totalPurchase,
      sale: totalSales,
      profit: totalSales - totalPurchase
    };
  }, [rows, selectedMonth, selectedYear, selectedWeek, availableWeeks]);

  const sortedRows = useMemo(() => {
    const getComparableValue = (row: StockRow, key: keyof StockRow) => {
      // Special handling for category_id - use category name for sorting
      if (key === 'category_id') {
        const category = categories.find(cat => cat.id === row.category_id);
        return category ? category.category_name.toLowerCase() : '';
      }

      const value = row[key];

      if (value === null || value === undefined) {
        return '';
      }

      if (key === 'id') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
      }

      if (key === 'purchase_price' || key === 'sale_price' || key === 'net_profit') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
      }

      if (key === 'purchase_date' || key === 'sale_date') {
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
      }

      return String(value).toLowerCase();
    };

    if (!sortConfig) {
      // Default sort: by ID descending (highest/newest first)
      return [...filteredRows].sort((a, b) => {
        const aValue = getComparableValue(a, 'id');
        const bValue = getComparableValue(b, 'id');
        
        if (aValue === bValue) {
          return 0;
        }
        
        return aValue > bValue ? -1 : 1; // Descending order
      });
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filteredRows].sort((a, b) => {
      const aValue = getComparableValue(a, key);
      const bValue = getComparableValue(b, key);

      if (aValue === bValue) {
        return 0;
      }

      if (aValue > bValue) {
        return 1 * multiplier;
      }

      return -1 * multiplier;
    });
  }, [filteredRows, sortConfig, categories]);

  const exportToCSV = () => {
    if (sortedRows.length === 0) {
      return;
    }

    const headers = [
      'Item Name',
      'Category',
      'Purchase Price',
      'Purchase Date',
      'Sale Date',
      'Sale Price',
      'Sold Platform',
      'Profit'
    ];

    const csvRows = [
      headers.join(','),
      ...sortedRows.map((row) => {
        const purchasePrice = row.purchase_price
          ? (typeof row.purchase_price === 'number' ? row.purchase_price : parseFloat(String(row.purchase_price)) || 0)
          : '';
        const salePrice = row.sale_price
          ? (typeof row.sale_price === 'number' ? row.sale_price : parseFloat(String(row.sale_price)) || 0)
          : '';
        const profit = row.purchase_price && row.sale_price
          ? (typeof salePrice === 'number' && typeof purchasePrice === 'number' ? salePrice - purchasePrice : '')
          : '';

        return [
          `"${(row.item_name || '').replace(/"/g, '""')}"`,
          `"${(() => {
            const category = categories.find(cat => cat.id === row.category_id);
            return category ? category.category_name : '';
          })().replace(/"/g, '""')}"`,
          purchasePrice,
          row.purchase_date ? formatDate(row.purchase_date) : '',
          row.sale_date ? formatDate(row.sale_date) : '',
          salePrice,
          `"${(row.sold_platform || '').replace(/"/g, '""')}"`,
          profit
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `stock-export-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const computeDifference = (
    purchase: Nullable<string | number>,
    sale: Nullable<string | number>
  ) => {
    const normalize = (value: Nullable<string | number>) => {
      if (value === null || value === undefined) {
        return Number.NaN;
      }

      if (typeof value === 'number') {
        return Number.isNaN(value) ? Number.NaN : value;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        return Number.NaN;
      }

      const numeric = Number(trimmed);
      return Number.isNaN(numeric) ? Number.NaN : numeric;
    };

    const purchaseValue = normalize(purchase);
    const saleValue = normalize(sale);

    if (Number.isNaN(purchaseValue) || Number.isNaN(saleValue)) {
      return null;
    }

    return saleValue - purchaseValue;
  };

  const startEditingRow = (row: StockRow) => {
    if (creating) {
      return;
    }

    // Ensure row has a valid ID before setting editing state
    if (!row.id) {
      console.error('startEditingRow: Row has no ID', row);
      setError('Cannot edit item: missing ID');
      return;
    }

    console.log('startEditingRow - Setting editingRowId to:', row.id);
    setFormIntent('edit');
    setEditingRowId(Number(row.id));
    setCreateForm({
      item_name: row.item_name ?? '',
      category_id: row.category_id ? String(row.category_id) : '',
      purchase_price: stockDbNumberToFormString(row.purchase_price),
      purchase_date: normalizeDateInput(row.purchase_date ?? ''),
      sale_date: normalizeDateInput(row.sale_date ?? ''),
      sale_price: stockDbNumberToFormString(row.sale_price),
      sold_platform: row.sold_platform ?? '',
      vinted_id: row.vinted_id ?? '',
      ebay_id: row.ebay_id ?? '',
      depop_id: row.depop_id ?? '',
      brand_id: row.brand_id ? String(row.brand_id) : '',
      brand_tag_image_id: row.brand_tag_image_id != null ? String(row.brand_tag_image_id) : '',
      projected_sale_price: stockDbNumberToFormString(row.projected_sale_price),
      category_size_id: row.category_size_id != null ? String(row.category_size_id) : '',
      sourced_location: sourcedLocationFromRow(row),
    });
    console.log('startEditingRow - row data:', row);
    console.log('startEditingRow - vinted_id:', row.vinted_id);
    console.log('startEditingRow - form vinted_id:', row.vinted_id ?? '');
    setShowNewEntry(true);
    setSuccessMessage(null);
    
    // Scroll to edit form after DOM updates - with better mobile support
    setTimeout(() => {
      if (editFormRef.current) {
        // Use 'center' for mobile to ensure form is fully visible
        const isMobile = window.innerWidth <= 768;
        editFormRef.current.scrollIntoView({ 
          behavior: 'smooth', 
          block: isMobile ? 'center' : 'start',
          inline: 'nearest'
        });
        // Additional scroll adjustment for mobile to account for fixed headers
        if (isMobile) {
          setTimeout(() => {
            const rect = editFormRef.current?.getBoundingClientRect();
            if (rect && rect.top < 120) {
              window.scrollBy({
                top: rect.top - 120,
                behavior: 'smooth'
              });
            }
          }, 100);
        }
      }
    }, 150);
  };

  const resetCreateForm = () => {
    setCreateForm({
      item_name: '',
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
      sourced_location: 'charity_shop'
    });
  };

  const handleCreateChange = (key: keyof typeof createForm, value: string) => {
    setCreateForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'brand_id' && value !== prev.brand_id) {
        next.brand_tag_image_id = '';
      }
      if (key === 'category_id' && value !== prev.category_id) {
        next.category_size_id = '';
      }
      return next;
    });
  };

  const handleCreateSubmit = async (allowCreateDespiteEditIntent?: boolean) => {
    const currentEditingId = editingRowId;
    const forceCreate =
      allowCreateDespiteEditIntent === true;

    if (currentEditingId === null && formIntent === 'edit' && !forceCreate) {
      setShowCreateInsteadOfEditConfirm(true);
      return;
    }

    try {
      setCreating(true);
      setError(null);
      setShowCreateInsteadOfEditConfirm(false);

      const payload = {
        item_name: createForm.item_name,
        category_id: createForm.category_id ? Number(createForm.category_id) : null,
        purchase_price: createForm.purchase_price,
        purchase_date: createForm.purchase_date,
        sale_date: createForm.sale_date,
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
        sourced_location: createForm.sourced_location || 'charity_shop'
      };

      console.log('Stock submit - Payload:', payload);
      console.log('Stock submit - editingRowId:', currentEditingId);
      console.log('Stock submit - brand_id value:', createForm.brand_id);
      console.log('Stock submit - brand_id in payload:', payload.brand_id);

      // Check if we're editing or creating
      const isEditing = currentEditingId !== null;
      const url = isEditing ? `${API_BASE}/api/stock/${currentEditingId}` : `${API_BASE}/api/stock`;
      const method = isEditing ? 'PUT' : 'POST';
      
      console.log('Stock submit - Method:', method, 'URL:', url);

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
      const updatedRow: StockRow | undefined = data?.row;

      console.log('Stock update response - updatedRow:', updatedRow);
      console.log('Stock update response - brand_id:', updatedRow?.brand_id);
      console.log('Stock update response - vinted_id:', updatedRow?.vinted_id);

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      if (isEditing) {
        setRows((prev) =>
          prev.map((row) =>
            Number(row.id) === Number(updatedRow.id) ? updatedRow : row
          )
        );
        setSuccessMessage('Stock record updated successfully.');
      } else {
        setRows((prev) => [updatedRow, ...prev]);
        setSuccessMessage('Stock record created successfully.');
      }

      // Hide the edit section after successful save
      setShowNewEntry(false);
      setEditingRowId(null);
      setFormIntent('create');
      setShowCreateInsteadOfEditConfirm(false);
      resetCreateForm();
      setSortConfig(null);
      
      console.log('Stock submit - Success:', isEditing ? 'Updated' : 'Created', 'ID:', updatedRow.id);
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

    if (key === 'net_profit') {
      return formatCurrency(value as Nullable<string | number>);
    }

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

  const handleCloseDataPanel = useCallback(() => {
    setIsDataPanelClosing(true);
    window.setTimeout(() => {
      setSelectedDataRow(null);
      setSelectedRowElement(null);
      setOfferPrice('');
      setPromotedFee('10');
      setIsDataPanelClosing(false);
    }, 220);
  }, []);

  // Close modal on ESC key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedDataRow) {
        handleCloseDataPanel();
      }
    };

    if (selectedDataRow) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [selectedDataRow, handleCloseDataPanel]);

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
      
      // Close the form and reset
      setShowNewEntry(false);
      setEditingRowId(null);
      setFormIntent('create');
      setShowCreateInsteadOfEditConfirm(false);
      resetCreateForm();
      setShowDeleteConfirm(false);
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
    const text = buildStockListingImageBackgroundPrompt(brandName);
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMessage(
        'Image Prompt copied — paste into ChatGPT, then upload your photo when asked.'
      );
      window.setTimeout(() => setSuccessMessage(null), 5000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }, [editingRowId, brands, createForm.brand_id]);

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

  /** One-line metrics for edit row 1 and new-item form: Vinted | eBay | eBay with fee | Profit. */
  const buildStockEditMetricsPipeline = (): { plain: string; content: React.ReactNode } => {
    const fmt = (n: number) =>
      n >= 0 ? `£${n.toFixed(2)}` : `-£${Math.abs(n).toFixed(2)}`;
    const multStr = (profit: number, purchase: number) =>
      purchase > 0 ? `${(profit / purchase).toFixed(2)}x` : '—';

    const purchaseParsed = parseStockMoneyInput(createForm.purchase_price);
    const hasPurchasePrice = Number.isFinite(purchaseParsed);

    const actualSaleParsed = parseStockMoneyInput(createForm.sale_price);
    /** Only treat as “sold at this price” when sale is a positive number; empty/0 keeps projected in play. */
    const hasUsableActualSale = Number.isFinite(actualSaleParsed) && actualSaleParsed > 0;

    const projectedRaw = String(createForm.projected_sale_price ?? '').trim();
    const hasProjectedPrice = projectedRaw !== '';
    const projectedSaleParsed = parseStockMoneyInput(createForm.projected_sale_price);

    /** Sale price wins for Vinted/eBay when there is a real sold price; otherwise use projected. */
    const saleForPlatforms = hasUsableActualSale
      ? actualSaleParsed
      : hasProjectedPrice && Number.isFinite(projectedSaleParsed) && projectedSaleParsed >= 0
        ? projectedSaleParsed
        : null;

    const rawSale = String(createForm.sale_price ?? '').trim();
    let profitAmt = 0;
    let profitMultOut = '—';
    if (rawSale !== '') {
      const sp = parseStockMoneyInput(createForm.sale_price);
      const pp = purchaseParsed;
      if (Number.isFinite(sp) && Number.isFinite(pp)) {
        profitAmt = sp - pp;
        profitMultOut = pp > 0 ? `${(profitAmt / pp).toFixed(2)}x` : '—';
      }
    }
    const profitSeg = `${fmt(profitAmt)} / ${profitMultOut}`;
    const profitLineTone =
      rawSale !== '' &&
      Number.isFinite(parseStockMoneyInput(createForm.sale_price)) &&
      Number.isFinite(purchaseParsed)
        ? profitAmt
        : null;

    const valuationsUseActualSale = hasUsableActualSale;
    const soldPlat = createForm.sold_platform;
    const highlightVinted = valuationsUseActualSale && soldPlatformIsVintedStock(soldPlat);
    const highlightEbay = valuationsUseActualSale && soldPlatformIsEbayStock(soldPlat);

    type SegmentHighlight = false | 'sold-platform' | 'profit-with-sale';
    const pipelineValueClass = (profitTone: number | null): string => {
      if (profitTone === null || !Number.isFinite(profitTone)) {
        return 'stock-edit-metrics-pipeline-value stock-edit-metrics-pipeline-value--neutral';
      }
      if (profitTone > 0) return 'stock-edit-metrics-pipeline-value stock-edit-metrics-pipeline-value--positive';
      if (profitTone < 0) return 'stock-edit-metrics-pipeline-value stock-edit-metrics-pipeline-value--negative';
      return 'stock-edit-metrics-pipeline-value stock-edit-metrics-pipeline-value--neutral';
    };
    const segment = (
      label: string,
      valuePart: string,
      highlight: SegmentHighlight = false,
      profitTone: number | null = null,
    ) => {
      const body = (
        <>
          <strong className="stock-edit-metrics-pipeline-label">{label}</strong>
          {': '}
          <span className={pipelineValueClass(profitTone)}>{valuePart}</span>
        </>
      );
      if (highlight === 'sold-platform') {
        return (
          <span className="stock-edit-metrics-pipeline-seg stock-edit-metrics-pipeline-seg--sold-platform">
            {body}
          </span>
        );
      }
      if (highlight === 'profit-with-sale') {
        return (
          <span className="stock-edit-metrics-pipeline-seg stock-edit-metrics-pipeline-seg--profit-with-sale">
            {body}
          </span>
        );
      }
      return body;
    };

    const profitHighlight: SegmentHighlight = hasUsableActualSale ? 'profit-with-sale' : false;

    const cannotComputePlatforms = !hasPurchasePrice || saleForPlatforms === null;

    if (cannotComputePlatforms) {
      const itemPartial = hasPurchasePrice ? purchaseParsed : 0;
      const multPlaceholder = itemPartial > 0 ? '0.00x' : '—';
      const z = `£0.00 / ${multPlaceholder}`;
      const plain = `Vinted: ${z} | eBay: ${z}\neBay with fee: ${z} | Profit: ${profitSeg}`;
      const content = (
        <>
          <span className="stock-edit-metrics-pipeline-row">
            {segment('Vinted', z, false, null)}
            {' | '}
            {segment('eBay', z, false, null)}
          </span>
          <span className="stock-edit-metrics-pipeline-row">
            {segment('eBay with fee', z, false, null)}
            {' | '}
            {segment('Profit', profitSeg, profitHighlight, profitLineTone)}
          </span>
        </>
      );
      return { plain, content };
    }

    const item = hasPurchasePrice ? purchaseParsed : 0;
    const sale = saleForPlatforms;
    const listingFees = 0.1;
    const promotedPercent = 10;
    const promotedFee = (sale * promotedPercent) / 100;
    const vintedProfit = sale - item;
    const ebayProfitWithoutPromo = sale - (item + listingFees);
    const totalCosts = item + listingFees + promotedFee;
    const ebayProfitWithPromo = sale - totalCosts;

    const vintedPart = `${fmt(vintedProfit)} / ${multStr(vintedProfit, item)}`;
    const ebayPart = `${fmt(ebayProfitWithoutPromo)} / ${multStr(ebayProfitWithoutPromo, item)}`;
    const ebayFeePart = `${fmt(ebayProfitWithPromo)} / ${multStr(ebayProfitWithPromo, item)}`;
    const plain =
      `Vinted: ${vintedPart} | eBay: ${ebayPart}\neBay with fee: ${ebayFeePart} | Profit: ${profitSeg}`;
    const content = (
      <>
        <span className="stock-edit-metrics-pipeline-row">
          {segment('Vinted', vintedPart, highlightVinted ? 'sold-platform' : false, vintedProfit)}
          {' | '}
          {segment('eBay', ebayPart, highlightEbay ? 'sold-platform' : false, ebayProfitWithoutPromo)}
        </span>
        <span className="stock-edit-metrics-pipeline-row">
          {segment('eBay with fee', ebayFeePart, highlightEbay ? 'sold-platform' : false, ebayProfitWithPromo)}
          {' | '}
          {segment('Profit', profitSeg, profitHighlight, profitLineTone)}
        </span>
      </>
    );
    return { plain, content };
  };

  const stockEditMetricsPipeline = buildStockEditMetricsPipeline();

  return (
    <div className={`stock-container ${showNewEntry ? 'editing-mode' : ''}`}>
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      {showNewEntry && (
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
                    if (!creating && !deleting) {
                      setShowNewEntry(false);
                      setEditingRowId(null);
                      setFormIntent('create');
                      setShowCreateInsteadOfEditConfirm(false);
                      resetCreateForm();
                      setShowDeleteConfirm(false);
                    }
                  }}
                  disabled={creating || deleting}
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
                  <div className="stock-edit-sku-id-circle" title={`SKU ${editingRowId}`}>
                    {editingRowId}
                  </div>
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
              <div className="stock-new-entry-top-bar-metrics">
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
                <div className="new-entry-field stock-new-entry-top-bar-pipeline">
                  <div className="stock-edit-row-1-metrics-box stock-new-entry-row2-pipeline-box">
                    <div
                      className="stock-edit-metrics-pipeline"
                      role="region"
                      aria-label="Projected profit by platform"
                      title={stockEditMetricsPipeline.plain}
                    >
                      {stockEditMetricsPipeline.content}
                    </div>
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
                  <div className="new-entry-field stock-new-entry-brand-field" style={{ position: 'relative' }}>
                    <div className="new-entry-field-label-row">
                      <span id="stock-form-brand-label">Brand</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddBrand(!showAddBrand);
                          setNewBrandName('');
                        }}
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
                        title="Add new brand"
                      >
                        +
                      </button>
                    </div>
                    <select
                      className="new-entry-select"
                      aria-labelledby="stock-form-brand-label"
                      value={createForm.brand_id}
                      onChange={(event) => handleCreateChange('brand_id', event.target.value)}
                    >
                      <option value="">-- No Brand --</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={String(brand.id)}>
                          {brand.brand_name}
                        </option>
                      ))}
                    </select>
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
                            background: 'rgba(5, 4, 3, 0.6)',
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
                  <div className="new-entry-field stock-new-entry-category-field" style={{ position: 'relative' }}>
                    <div className="new-entry-field-label-row">
                      <span id="stock-form-category-label">Category</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCategory(!showAddCategory);
                          setNewCategoryName('');
                        }}
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
                        title="Add new category"
                      >
                        +
                      </button>
                    </div>
                    <select
                      className="new-entry-select"
                      aria-labelledby="stock-form-category-label"
                      value={createForm.category_id}
                      onChange={(event) => handleCreateChange('category_id', event.target.value)}
                    >
                      <option value="">Select category...</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.category_name}
                        </option>
                      ))}
                    </select>
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
                            background: 'rgba(5, 4, 3, 0.6)',
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
                  <label className="new-entry-field stock-new-entry-size-field">
                    <span id="stock-form-size-label">Size</span>
                    <select
                      className="new-entry-select"
                      aria-labelledby="stock-form-size-label"
                      value={createForm.category_size_id}
                      onChange={(event) => handleCreateChange('category_size_id', event.target.value)}
                      disabled={!createForm.category_id?.trim() || categorySizesLoading}
                    >
                      <option value="">
                        {!createForm.category_id?.trim()
                          ? 'Select category first'
                          : categorySizesLoading
                            ? 'Loading…'
                            : 'None'}
                      </option>
                      {categorySizes.map((siz) => (
                        <option key={siz.id} value={String(siz.id)}>
                          {siz.size_label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="new-entry-field stock-new-entry-tags-field">
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
                              {brandTagImages.map((t) => {
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
              </div>
            </div>
            {/* Purchase, projected, date, sourced */}
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
              <label className="new-entry-field new-entry-field--stock-compact-price new-entry-field--stock-row2-equal">
                <span className="stock-new-entry-row2-projected-label">Projected Price (£)</span>
                <input
                  type="text"
                  className="stock-edit-projected-price-input"
                  value={createForm.projected_sale_price}
                  onChange={(event) => handleCreateChange('projected_sale_price', event.target.value)}
                  placeholder="0.00"
                  aria-label="Projected price (£)"
                />
              </label>
              <label className="new-entry-field new-entry-field--stock-compact-date new-entry-field--stock-row2-equal">
                <span>Purchase Date</span>
                <DatePicker
                  selected={stringToDate(createForm.purchase_date)}
                  onChange={(date) =>
                    handleCreateChange('purchase_date', dateToIsoString(date ?? null))
                  }
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select purchase date"
                  className="date-picker-input"
                  calendarClassName="date-picker-calendar"
                  wrapperClassName="date-picker-wrapper"
                />
              </label>
              <label className="new-entry-field new-entry-field--stock-compact-source new-entry-field--stock-row2-equal">
                <span>Sourced</span>
                <select
                  className="new-entry-select"
                  value={createForm.sourced_location}
                  onChange={(event) => handleCreateChange('sourced_location', event.target.value)}
                  aria-label="Where the item was sourced"
                >
                  {SOURCED_LOCATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* Row 3 (+ edit sales fields): IDs, My Sales / date / platform when editing, save */}
            <div
              className={
                editingRowId
                  ? 'stock-new-entry-row-ids stock-new-entry-row-ids--edit'
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
              {editingRowId && (
                <>
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
                      selected={stringToDate(createForm.sale_date)}
                      onChange={(date) =>
                        handleCreateChange('sale_date', dateToIsoString(date ?? null))
                      }
                      dateFormat="yyyy-MM-dd"
                      placeholderText="Select sale date"
                      className="date-picker-input"
                      calendarClassName="date-picker-calendar"
                      wrapperClassName="date-picker-wrapper"
                    />
                  </label>
                  <div
                    className="new-entry-field stock-new-entry-sold-platform-field"
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
                        style={{
                          position: 'relative',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '11px 13px',
                          borderRadius: '14px',
                          border: '1px solid rgba(255, 214, 91, 0.28)',
                          background: 'rgba(255, 214, 91, 0.08)',
                          color: 'var(--text-strong)',
                          gap: '6px',
                          minHeight: '46px',
                          height: 'auto',
                          lineHeight: '1.2',
                          boxSizing: 'border-box',
                        }}
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
                </>
              )}
              <div className="stock-new-entry-row3-save">
                <span className="stock-new-entry-row3-save-label-spacer" aria-hidden>
                  &nbsp;
                </span>
                {editingRowId ? (
                  <button
                    type="button"
                    className="save-button stock-edit-save-disk"
                    onClick={() => {
                      void handleCreateSubmit();
                    }}
                    disabled={creating || deleting}
                    aria-label={creating ? 'Saving changes' : 'Save changes'}
                    title={creating ? 'Saving…' : 'Save changes'}
                  >
                    {creating ? (
                      <span className="stock-edit-save-disk-spinner" aria-hidden />
                    ) : (
                      <svg
                        className="stock-edit-save-disk-icon"
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
                  </button>
                ) : (
                  <button
                    type="button"
                    className="stock-new-entry-save-circle"
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
                        className="stock-new-entry-save-icon"
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
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
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

      <div className="stock-filters">
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
                  setSelectedYear('last-30-days');
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
            onChange={(event) => setViewMode(event.target.value as 'all' | 'active-listing' | 'sales' | 'listing' | 'to-list' | 'list-on-vinted' | 'list-on-ebay')}
            className="filter-select"
          >
            <option value="all">All</option>
            <option value="active-listing">Active</option>
            <option value="sales">Sold Items</option>
            <option value="listing">Add This Month</option>
            <option value="to-list">To List</option>
            <option value="list-on-vinted">To List On Vinted</option>
            <option value="list-on-ebay">To List On eBay</option>
          </select>
          <button
            type="button"
            className="stock-refresh-icon-button"
            onClick={loadStock}
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
          <span className="summary-value">{sortedRows.length.toLocaleString()}</span>
        </div>
      </section>

      {selectedDataRow && selectedRowElement && (() => {
        const metrics = computeDataPanelMetrics(selectedDataRow);
        const rect = selectedRowElement.getBoundingClientRect();
        const container = selectedRowElement.closest('.stock-container') as HTMLElement;
        const containerRect = container?.getBoundingClientRect();
        
        if (!container || !containerRect) return null;
        
        // Calculate position relative to container
        const top = rect.top - containerRect.top - 10;
        const left = 0;
        const width = containerRect.width;
        
        return (
          <div 
            className={`stock-data-overlay${isDataPanelClosing ? ' closing' : ''}`}
            style={{
              position: 'absolute',
              top: `${top}px`,
              left: `${left}px`,
              width: `${width}px`,
              zIndex: 1000
            }}
          >
            <div 
              className="stock-data-panel"
            >
              <div className="stock-data-panel-grid" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="stock-data-close-button stock-data-close-button-mobile"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseDataPanel();
                  }}
                  aria-label="Close panel"
                >
                  × Close
                </button>
                <div className="stock-data-item stock-data-item-title">
                  <div className="stock-data-value stock-data-title">
                    {selectedDataRow.item_name || '—'}
                  </div>
                  <div className="stock-data-title-actions">
                    <button
                      type="button"
                      className="stock-data-copy-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const title = selectedDataRow.item_name || '';
                        if (title) {
                          navigator.clipboard.writeText(title).then(() => {
                            // Optional: Show a brief success message
                          }).catch(err => {
                            console.error('Failed to copy:', err);
                          });
                        }
                      }}
                      aria-label="Copy item title to clipboard"
                    >
                      📋
                    </button>
                    <button
                      type="button"
                      className="stock-data-close-button stock-data-close-button-desktop"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseDataPanel();
                      }}
                      aria-label="Close panel"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Buy Price</div>
                  <div className="stock-data-value">
                    {!Number.isNaN(metrics.purchase)
                      ? formatCurrency(metrics.purchase)
                      : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Sold Price</div>
                  <div className="stock-data-value">
                    {!Number.isNaN(metrics.sale)
                      ? formatCurrency(metrics.sale)
                      : selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined
                        ? formatCurrency(0)
                        : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Profit</div>
                  <div className={`stock-data-value ${!Number.isNaN(metrics.profit) && metrics.profit < 0 ? 'negative' : 'positive'}`}>
                    {!Number.isNaN(metrics.profit)
                      ? formatCurrency(metrics.profit)
                      : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Profit Multiple</div>
                  <div className="stock-data-value">
                    {metrics.profitMultiple || 
                      ((selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined) && !Number.isNaN(metrics.purchase) && metrics.purchase > 0
                        ? '0.00x'
                        : '—')}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Days For Sale</div>
                  <div className="stock-data-value">
                    {metrics.daysForSale !== null 
                      ? `${metrics.daysForSale} days` 
                      : (selectedDataRow.purchase_date && (selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined))
                        ? '0 days'
                        : '—'}
                  </div>
                </div>
                {selectedDataRow.vinted_id && selectedDataRow.vinted_id.trim() && (
                  <div className="stock-data-item">
                    <div className="stock-data-label">Vinted Listing</div>
                    <div className="stock-data-value">
                      <a
                        href={`https://www.vinted.co.uk/items/${selectedDataRow.vinted_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          textDecoration: 'underline',
                          cursor: 'pointer'
                        }}
                      >
                        View on Vinted
                      </a>
                    </div>
                  </div>
                )}
                {selectedDataRow.ebay_id && selectedDataRow.ebay_id.trim() && (
                  <div className="stock-data-item">
                    <div className="stock-data-label">eBay Listing</div>
                    <div className="stock-data-value">
                      <a
                        href={`https://www.ebay.co.uk/itm/${selectedDataRow.ebay_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          textDecoration: 'underline',
                          cursor: 'pointer'
                        }}
                      >
                        View on eBay
                      </a>
                    </div>
                  </div>
                )}
                {selectedDataRow.depop_id && selectedDataRow.depop_id.trim() && (
                  <div className="stock-data-item">
                    <div className="stock-data-label">Depop Listing</div>
                    <div className="stock-data-value">
                      <a
                        href={`https://www.depop.com/products/${selectedDataRow.depop_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          textDecoration: 'underline',
                          cursor: 'pointer'
                        }}
                      >
                        View on Depop
                      </a>
                    </div>
                  </div>
                )}
                <div className="stock-data-prediction-section" onClick={(e) => e.stopPropagation()}>
                  <div className="stock-data-prediction-input-group">
                    <label className="stock-data-label">Offer</label>
                    <input
                      type="number"
                      value={offerPrice}
                      onChange={(e) => setOfferPrice(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="stock-data-prediction-input"
                    />
                  </div>
                  <div className="stock-data-prediction-input-group">
                    <label className="stock-data-label">Fee (%)</label>
                    <input
                      type="number"
                      value={promotedFee}
                      onChange={(e) => setPromotedFee(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      placeholder="10"
                      step="0.1"
                      min="0"
                      max="100"
                      className="stock-data-prediction-input"
                    />
                  </div>
                  <div className="stock-data-prediction-result">
                    <label className="stock-data-label">Predicted Profit</label>
                    <div className="stock-data-prediction-profit-text">
                      {(() => {
                        const purchase = metrics.purchase;
                        const offer = parseFloat(offerPrice) || 0;
                        const feePercent = parseFloat(promotedFee) || 0;
                        
                        if (Number.isNaN(purchase) || purchase <= 0 || offer <= 0) {
                          return '—';
                        }
                        
                        // eBay Final Value Fee for clothing: 10%
                        const finalValueFeePercent = 10;
                        const totalFeePercent = finalValueFeePercent + feePercent;
                        // Fees are calculated on the sale price (purchase price)
                        const totalFees = purchase * (totalFeePercent / 100);
                        // Predicted Profit = Offer (total amount) - Purchase Price - Fees
                        const predictedProfit = offer - purchase - totalFees;
                        
                        return (
                          <span className={`stock-data-prediction-profit-value ${predictedProfit >= 0 ? 'positive' : 'negative'}`}>
                            {formatCurrency(predictedProfit)}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                <div className="stock-data-edit-button-container">
                  <button
                    type="button"
                    className="stock-data-edit-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseDataPanel();
                      navigate(`/stock?editId=${selectedDataRow.id}`);
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Desktop Table View */}
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
                >
                  Sale Date <span className="sort-indicator">{resolveSortIndicator('sale_date')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'sale_price' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('sale_price')}
                >
                  Sale Price <span className="sort-indicator">{resolveSortIndicator('sale_price')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'net_profit' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('net_profit')}
                >
                  Net Profit <span className="sort-indicator">{resolveSortIndicator('net_profit')}</span>
                </button>
              </th>
              <th className="stock-table-actions-header">Info</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-state">
                  No stock records found.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const storedProfit =
                row.net_profit !== null && row.net_profit !== undefined
                  ? Number(row.net_profit)
                  : computeDifference(row.purchase_price, row.sale_price);
              const profitValue = storedProfit;
              const profitClass =
                profitValue !== null
                  ? profitValue >= 0
                    ? 'profit-chip positive'
                    : 'profit-chip negative'
                  : 'profit-chip neutral';
              const profitDisplay = profitValue !== null ? formatCurrency(profitValue) : '—';

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
                  <td>{renderCellContent(row, 'purchase_price', formatCurrency)}</td>
                  <td>
                    {renderCellContent(
                      row,
                      'purchase_date',
                      (val) => formatDate(val as Nullable<string>),
                      true
                    )}
                  </td>
                  <td>
                    {renderCellContent(
                      row,
                      'sale_date',
                      (val) => formatDate(val as Nullable<string>),
                      true
                    )}
                  </td>
                  <td>{renderCellContent(row, 'sale_price', formatCurrency)}</td>
                  <td>
                    <span className={profitClass}>{profitDisplay}</span>
                  </td>
                  <td className="stock-table-actions-cell">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-hint-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsDataPanelClosing(false);
                          setSelectedDataRow(row);
                          setSelectedRowElement(event.currentTarget.closest('tr') as HTMLElement);
                        }}
                      >
                        Info
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="stock-cards-wrapper" ref={cardsWrapperRef}>
        {!loading && sortedRows.length === 0 && (
          <div className="stock-empty-state">
            No stock records found.
          </div>
        )}
        {sortedRows.slice(0, visibleItemsCount).map((row) => {
          const categoryName = categories.find(c => c.id === row.category_id)?.category_name || '—';
          const brandName = brands.find(b => b.id === row.brand_id)?.brand_name || '—';

          return (
            <div key={row.id} className="stock-card">
              <div className="stock-card-header">
                <span className="stock-card-sku"><span className="sku-label">SKU: </span>{row.id}</span>
                <button
                  type="button"
                  className="stock-card-info-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsDataPanelClosing(false);
                    setSelectedDataRow(row);
                    const cardElement = event.currentTarget.closest('.stock-card') as HTMLElement;
                    setSelectedRowElement(cardElement);
                  }}
                >
                  Info
                </button>
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
                {row.sale_date && (
                  <div className="stock-card-field">
                    <span className="stock-card-label">Sale Date</span>
                    <span className="stock-card-value">{formatDate(row.sale_date)}</span>
                  </div>
                )}
                {row.sale_price && (
                  <div className="stock-card-field">
                    <span className="stock-card-label">Sale Price</span>
                    <span className="stock-card-value">{formatCurrency(row.sale_price)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visibleItemsCount < sortedRows.length && (
          <div className="stock-cards-load-more">
            <button
              type="button"
              className="stock-load-more-button"
              onClick={() => setVisibleItemsCount(prev => Math.min(prev + 20, sortedRows.length))}
            >
              Load More ({sortedRows.length - visibleItemsCount} remaining)
            </button>
          </div>
        )}
      </div>

      <div className="export-section">
        <button
          type="button"
          className="export-button"
          onClick={exportToCSV}
          disabled={sortedRows.length === 0}
        >
          Export to CSV
        </button>
      </div>
    </div>
  );
};

export default Stock;
