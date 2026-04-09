import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApiBase } from '../utils/apiBase';
import './Config.css';
import './Stock.css';

const API_BASE = getApiBase();

async function copyConfigPromptToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
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
  category_size_id: Nullable<number>;
  brand_tag_image_id?: Nullable<number>;
  sourced_location?: Nullable<string>;
}

interface BrandTagImageRow {
  id: number;
  caption?: string | null;
  image_kind?: string | null;
  public_url?: string | null;
}

type NoTagsTagCacheEntry =
  | { state: 'loading' }
  | { state: 'ready'; rows: BrandTagImageRow[] }
  | { state: 'error'; message: string };

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

const MISC_BRAND_ID = 39;

/** Stock `category_id` values excluded from “Items With No Size” (sizes not applicable / not tracked). */
const NO_SIZE_LIST_EXCLUDED_CATEGORY_IDS = new Set([
  1, 2, 3, 7, 9, 13, 14, 26, 31, 38, 39,
]);

function stockRowIsOnNoSizeList(row: StockRow): boolean {
  const sz = row.category_size_id;
  if (sz != null && Number(sz) >= 1) return false;
  const cid = row.category_id;
  if (cid == null) return true;
  const n = Number(cid);
  if (!Number.isFinite(n)) return true;
  return !NO_SIZE_LIST_EXCLUDED_CATEGORY_IDS.has(n);
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

type ConfigMenu =
  | 'untagged-brand'
  | 'no-tags'
  | 'no-size'
  | 'no-ebay-id'
  | 'no-vinted-id'
  | 'duplicate-entries'
  | 'items-category-check'
  | 'clothing-type-categories'
  | 'clothing-categories'
  | 'sizes'
  | 'brands';

/** Normalise for duplicate detection: trim + lowercase; empty → null (ignored). */
function stockDuplicateNameKey(item_name: Nullable<string>): string | null {
  const t = item_name != null ? String(item_name).trim().toLowerCase() : '';
  return t === '' ? null : t;
}

interface ConfigBrandRow {
  id: number;
  brand_name: string;
  brand_website?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface ClothingCategoryRow {
  id: number;
  name: string;
  description: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Stock clothing type — `category` table, `stock.category_id`. */
interface StockClothingTypeRow {
  id: number;
  category_name: string;
  stock_count: number;
}

/** `category_size` row for Config → Sizes (includes stock usage count from API). */
interface CategorySizeAdminRow {
  id: number;
  category_id: number;
  size_label: string;
  sort_order: number;
  stock_ref_count: number;
}

/** True if the label is only an integer or decimal (dropdown ordering: numeric band). */
function isPlainNumericSizeLabel(label: string): boolean {
  const t = label.trim();
  if (t === '') return false;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return false;
  return Number.isFinite(Number(t));
}

/** Text labels first (A→Z), then numeric labels (high→low). */
function sortSizePickerOptions(rows: CategorySizeAdminRow[]): CategorySizeAdminRow[] {
  return [...rows].sort((a, b) => {
    const aNum = isPlainNumericSizeLabel(a.size_label);
    const bNum = isPlainNumericSizeLabel(b.size_label);
    if (aNum !== bNum) return aNum ? 1 : -1;
    if (!aNum) {
      return a.size_label.localeCompare(b.size_label, undefined, { sensitivity: 'base', numeric: true });
    }
    return Number(b.size_label.trim()) - Number(a.size_label.trim());
  });
}

/** Prompt: rank config brands using menswear category taxonomy (Research / Config “Menswear categories”). */
function buildBrandsRankByMenswearCategoriesPrompt(
  brands: ConfigBrandRow[],
  categories: ClothingCategoryRow[]
): string {
  const brandNames = brands
    .map((b) => String(b.brand_name ?? '').trim())
    .filter((n) => n.length > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const lines: string[] = [
    `I'm a UK menswear reseller (second-hand / resale). I track stock by **brand** and organise research using **menswear categories** in my app.`,
    ``,
    `Below are **every brand** currently in my database (names only) and my **menswear category** list (name, description, and my notes).`,
    ``,
    `## Brands in my database (${brandNames.length})`,
    ``,
  ];

  if (brandNames.length === 0) {
    lines.push(`*(No brands in the list.)*`, ``);
  } else {
    brandNames.forEach((name, i) => lines.push(`${i + 1}. ${name}`));
    lines.push(``);
  }

  lines.push(`## Menswear categories (${categories.length})`, ``);
  if (categories.length === 0) {
    lines.push(
      `*(No menswear categories defined yet. Still suggest how you would rank these brands against typical UK menswear resale buckets — outerwear, knitwear, denim, tailoring, etc. — so I can align when I add categories.)*`,
      ``
    );
  } else {
    categories.forEach((c, i) => {
      lines.push(`### ${i + 1}. ${c.name}`);
      if (c.description?.trim()) lines.push(c.description.trim());
      if (c.notes?.trim()) lines.push(`**My notes:** ${c.notes.trim()}`);
      lines.push(``);
    });
  }

  lines.push(
    `## What I need from you`,
    `1. **Per category** — For each menswear category above, **rank my brands** from strongest fit for UK resale (demand, typical product mix, realistic price band) to weaker or marginal fit. Use "N/A" or skip only when a brand almost never appears in that bucket.`,
    `2. **Overall** — A concise **overall ranking** or tiered view (e.g. core vs opportunistic) across categories.`,
    `3. **Risks** — Flag pairs of brands that are easy to confuse, or brands that are mainly womenswear/kids if that's well known.`,
    ``,
    `Only use the brand names I listed; don't invent brands. If unsure, say so briefly instead of guessing.`,
    `Today's date context: ${new Date().toISOString().slice(0, 10)}.`
  );

  return lines.join('\n');
}

const Config: React.FC = () => {
  const [activeMenu, setActiveMenu] = useState<ConfigMenu>('untagged-brand');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoTaggingId, setAutoTaggingId] = useState<number | null>(null);
  const [autoTaggedHiddenIds, setAutoTaggedHiddenIds] = useState<Set<number>>(new Set());

  const [noTagsBrandFilter, setNoTagsBrandFilter] = useState<string>('');
  const [tagImageCache, setTagImageCache] = useState<Record<number, NoTagsTagCacheEntry>>({});
  const [noTagsTagError, setNoTagsTagError] = useState<string | null>(null);
  const [assigningTagStockId, setAssigningTagStockId] = useState<number | null>(null);

  /** Sizes per clothing-type category for Items With No Size picker (not the Sizes admin table state). */
  const [noSizePickerSizesByCategory, setNoSizePickerSizesByCategory] = useState<
    Record<number, CategorySizeAdminRow[]>
  >({});
  const [noSizePickerSizesLoading, setNoSizePickerSizesLoading] = useState(false);
  const [noSizePickerError, setNoSizePickerError] = useState<string | null>(null);
  const [noSizeAssignSavingId, setNoSizeAssignSavingId] = useState<number | null>(null);

  const [clothingCategories, setClothingCategories] = useState<ClothingCategoryRow[]>([]);
  const [clothingLoading, setClothingLoading] = useState(false);
  const [clothingError, setClothingError] = useState<string | null>(null);
  const [clothingAddOpen, setClothingAddOpen] = useState(false);
  const [clothingAddName, setClothingAddName] = useState('');
  const [clothingAddDescription, setClothingAddDescription] = useState('');
  const [clothingAddNotes, setClothingAddNotes] = useState('');
  const [clothingAddSaving, setClothingAddSaving] = useState(false);
  const [clothingEditingId, setClothingEditingId] = useState<number | null>(null);
  const [clothingEditName, setClothingEditName] = useState('');
  const [clothingEditDescription, setClothingEditDescription] = useState('');
  const [clothingEditNotes, setClothingEditNotes] = useState('');
  const [clothingEditSaving, setClothingEditSaving] = useState(false);
  const [clothingDeleteSaving, setClothingDeleteSaving] = useState(false);

  const [stockClothingTypes, setStockClothingTypes] = useState<StockClothingTypeRow[]>([]);
  const [stockTypesLoading, setStockTypesLoading] = useState(false);
  const [stockTypesError, setStockTypesError] = useState<string | null>(null);
  const [stockTypeAddOpen, setStockTypeAddOpen] = useState(false);
  const [stockTypeAddName, setStockTypeAddName] = useState('');
  const [stockTypeAddSaving, setStockTypeAddSaving] = useState(false);
  const [stockTypeEditingId, setStockTypeEditingId] = useState<number | null>(null);
  const [stockTypeEditName, setStockTypeEditName] = useState('');
  const [stockTypeEditSaving, setStockTypeEditSaving] = useState(false);
  const [stockTypeDeleteSaving, setStockTypeDeleteSaving] = useState(false);

  const [brands, setBrands] = useState<ConfigBrandRow[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [brandAddOpen, setBrandAddOpen] = useState(false);
  const [brandAddName, setBrandAddName] = useState('');
  const [brandAddSaving, setBrandAddSaving] = useState(false);
  const [brandEditingId, setBrandEditingId] = useState<number | null>(null);
  const [brandEditName, setBrandEditName] = useState('');
  const [brandEditWebsite, setBrandEditWebsite] = useState('');
  const [brandEditSaving, setBrandEditSaving] = useState(false);
  const [brandsAskAiHint, setBrandsAskAiHint] = useState<string | null>(null);
  const brandsAskAiHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sizesCategoryId, setSizesCategoryId] = useState<string>('');
  const [categorySizeRows, setCategorySizeRows] = useState<CategorySizeAdminRow[]>([]);
  const [sizesLoading, setSizesLoading] = useState(false);
  const [sizesError, setSizesError] = useState<string | null>(null);
  const [sizeAddOpen, setSizeAddOpen] = useState(false);
  const [sizeAddLabel, setSizeAddLabel] = useState('');
  const [sizeAddSort, setSizeAddSort] = useState('');
  const [sizeAddSaving, setSizeAddSaving] = useState(false);
  const [sizeEditingId, setSizeEditingId] = useState<number | null>(null);
  const [sizeEditLabel, setSizeEditLabel] = useState('');
  const [sizeEditSort, setSizeEditSort] = useState('');
  const [sizeEditSaving, setSizeEditSaving] = useState(false);
  const [sizeDeleteSaving, setSizeDeleteSaving] = useState(false);
  const [duplicateDeleteId, setDuplicateDeleteId] = useState<number | null>(null);
  const [categoryCheckCategoryId, setCategoryCheckCategoryId] = useState('');
  const [categoryCheckUpdatingId, setCategoryCheckUpdatingId] = useState<number | null>(null);
  const [categoryCheckError, setCategoryCheckError] = useState<string | null>(null);

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
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: any) {
      console.error('Stock load error:', err);
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

  useEffect(() => {
    loadStock();
  }, []);

  const noTagsRowsWithoutTag = useMemo(() => {
    return rows.filter((row) => {
      const tid = row.brand_tag_image_id;
      if (tid != null && tid !== undefined && Number(tid) >= 1) return false;
      return true;
    });
  }, [rows]);

  const noTagsFilteredRows = useMemo(() => {
    if (noTagsBrandFilter === '') return noTagsRowsWithoutTag;
    const bid = Number(noTagsBrandFilter);
    if (!Number.isInteger(bid) || bid < 1) return noTagsRowsWithoutTag;
    return noTagsRowsWithoutTag.filter((row) => row.brand_id === bid);
  }, [noTagsRowsWithoutTag, noTagsBrandFilter]);

  const noTagsBrandIdsToLoad = useMemo(() => {
    const s = new Set<number>();
    for (const row of noTagsRowsWithoutTag) {
      const b = row.brand_id;
      if (b != null && Number(b) >= 1) s.add(Math.floor(Number(b)));
    }
    return Array.from(s).sort((a, b) => a - b);
  }, [noTagsRowsWithoutTag]);

  const noTagsBrandIdsWithUntaggedStock = useMemo(() => {
    const s = new Set<number>();
    for (const row of noTagsRowsWithoutTag) {
      const b = row.brand_id;
      if (b != null && Number(b) >= 1) s.add(Math.floor(Number(b)));
    }
    return s;
  }, [noTagsRowsWithoutTag]);

  const brandsSortedForFilter = useMemo(() => {
    return [...brands].sort((a, b) =>
      (a.brand_name || '').localeCompare(b.brand_name || '', undefined, { sensitivity: 'base' })
    );
  }, [brands]);

  const brandNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of brands) {
      m.set(b.id, (b.brand_name || '').trim() || `Brand #${b.id}`);
    }
    return m;
  }, [brands]);

  const noTagsDisplayRows = useMemo(() => {
    return noTagsFilteredRows.filter((row) => {
      const bid =
        row.brand_id != null && Number.isFinite(Number(row.brand_id))
          ? Math.floor(Number(row.brand_id))
          : null;
      if (bid == null) return false;
      const e = tagImageCache[bid];
      return e?.state === 'ready' && e.rows.length > 0;
    });
  }, [noTagsFilteredRows, tagImageCache]);

  const noTagsBrandFilterOptions = useMemo(() => {
    return brandsSortedForFilter.filter((b) => {
      if (!noTagsBrandIdsWithUntaggedStock.has(b.id)) return false;
      const e = tagImageCache[b.id];
      return e?.state === 'ready' && e.rows.length > 0;
    });
  }, [brandsSortedForFilter, noTagsBrandIdsWithUntaggedStock, tagImageCache]);

  const noTagsBrandTagsStillLoading = useMemo(() => {
    for (const bid of noTagsBrandIdsToLoad) {
      const e = tagImageCache[bid];
      if (e === undefined || e.state === 'loading') return true;
    }
    return false;
  }, [noTagsBrandIdsToLoad, tagImageCache]);

  useEffect(() => {
    if (activeMenu !== 'no-tags' || noTagsBrandIdsToLoad.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const brandId of noTagsBrandIdsToLoad) {
        if (cancelled) return;
        setTagImageCache((prev) => {
          const ex = prev[brandId];
          if (ex?.state === 'ready' || ex?.state === 'loading') return prev;
          return { ...prev, [brandId]: { state: 'loading' } };
        });
        try {
          const res = await fetch(
            `${API_BASE}/api/brand-tag-images?brandId=${encodeURIComponent(String(brandId))}`,
            { headers: { 'Content-Type': 'application/json' } }
          );
          const text = await res.text();
          if (!res.ok) {
            let msg = text || 'Failed to load tags';
            try {
              const j = JSON.parse(text) as { error?: string };
              if (j.error) msg = j.error;
            } catch {
              /* keep */
            }
            throw new Error(msg);
          }
          const data = JSON.parse(text) as { rows?: BrandTagImageRow[] };
          const tagRows = Array.isArray(data.rows) ? data.rows : [];
          if (cancelled) return;
          setTagImageCache((prev) => ({
            ...prev,
            [brandId]: { state: 'ready', rows: tagRows },
          }));
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : 'Failed to load tags';
          setTagImageCache((prev) => ({
            ...prev,
            [brandId]: { state: 'error', message: msg },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMenu, noTagsBrandIdsToLoad]);

  useEffect(() => {
    if (activeMenu !== 'no-tags') return;
    if (noTagsBrandFilter === '') return;
    const bid = Number(noTagsBrandFilter);
    if (!Number.isInteger(bid) || bid < 1) {
      setNoTagsBrandFilter('');
      return;
    }
    const e = tagImageCache[bid];
    if (e === undefined || e.state === 'loading') return;
    if (e.state === 'error' || (e.state === 'ready' && e.rows.length === 0)) {
      setNoTagsBrandFilter('');
    }
  }, [activeMenu, noTagsBrandFilter, tagImageCache]);

  const loadClothingCategories = useCallback(async () => {
    try {
      setClothingLoading(true);
      setClothingError(null);
      const response = await fetch(`${API_BASE}/api/menswear-categories`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to load categories';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as { rows?: ClothingCategoryRow[] };
      setClothingCategories(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: unknown) {
      console.error('Menswear categories load error:', err);
      const m = err instanceof Error ? err.message : 'Unable to load categories';
      if (m === 'Failed to fetch' || (err instanceof TypeError && err.name === 'TypeError')) {
        setClothingError('Unable to connect to server (is the API running on port 5003?)');
      } else {
        setClothingError(m);
      }
      setClothingCategories([]);
    } finally {
      setClothingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === 'clothing-categories') {
      void loadClothingCategories();
    }
  }, [activeMenu, loadClothingCategories]);

  const loadStockClothingTypes = useCallback(async () => {
    try {
      setStockTypesLoading(true);
      setStockTypesError(null);
      const response = await fetch(`${API_BASE}/api/categories`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to load clothing types';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as { rows?: unknown[] };
      const raw = Array.isArray(data.rows) ? data.rows : [];
      const rows: StockClothingTypeRow[] = raw.map((r) => {
        const o = r as Record<string, unknown>;
        const id = Number(o.id);
        const sc = o.stock_count;
        const stockCount =
          typeof sc === 'number' && Number.isFinite(sc)
            ? Math.max(0, Math.floor(sc))
            : Number.parseInt(String(sc ?? '0'), 10) || 0;
        return {
          id: Number.isFinite(id) ? Math.floor(id) : -1,
          category_name: String(o.category_name ?? '').trim(),
          stock_count: stockCount,
        };
      });
      setStockClothingTypes(rows.filter((r) => r.id >= 1));
    } catch (err: unknown) {
      console.error('Stock clothing types load error:', err);
      const m = err instanceof Error ? err.message : 'Unable to load clothing types';
      if (m === 'Failed to fetch' || (err instanceof TypeError && err.name === 'TypeError')) {
        setStockTypesError('Unable to connect to server (is the API running on port 5003?)');
      } else {
        setStockTypesError(m);
      }
      setStockClothingTypes([]);
    } finally {
      setStockTypesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === 'clothing-type-categories') {
      void loadStockClothingTypes();
    }
  }, [activeMenu, loadStockClothingTypes]);

  /** Load sizes for one category without touching Sizes admin table state. */
  const fetchCategorySizesForPicker = useCallback(async (categoryId: number): Promise<CategorySizeAdminRow[]> => {
    const response = await fetch(
      `${API_BASE}/api/category-sizes?categoryId=${encodeURIComponent(String(categoryId))}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );
    const text = await response.text();
    if (!response.ok) {
      let msg = text || 'Failed to load sizes';
      try {
        const j = JSON.parse(text) as { error?: string; details?: string };
        msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
      } catch {
        /* keep */
      }
      throw new Error(msg);
    }
    const data = JSON.parse(text) as { rows?: unknown[] };
    const raw = Array.isArray(data.rows) ? data.rows : [];
    const mapped: CategorySizeAdminRow[] = raw.map((r) => {
      const o = r as Record<string, unknown>;
      const id = Number(o.id);
      const refRaw = o.stock_ref_count;
      let ref = 0;
      if (typeof refRaw === 'number' && Number.isFinite(refRaw)) ref = Math.max(0, Math.floor(refRaw));
      else ref = Math.max(0, parseInt(String(refRaw ?? '0'), 10) || 0);
      return {
        id: Number.isFinite(id) ? Math.floor(id) : -1,
        category_id: Math.floor(Number(o.category_id) || 0),
        size_label: String(o.size_label ?? '').trim(),
        sort_order: Math.floor(Number(o.sort_order) || 0),
        stock_ref_count: ref,
      };
    });
    return mapped.filter((x) => x.id >= 1);
  }, []);

  const loadCategorySizesAdmin = useCallback(async (categoryId: number) => {
    try {
      setSizesLoading(true);
      setSizesError(null);
      const response = await fetch(
        `${API_BASE}/api/category-sizes?categoryId=${encodeURIComponent(String(categoryId))}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to load sizes';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as { rows?: unknown[] };
      const raw = Array.isArray(data.rows) ? data.rows : [];
      const rows: CategorySizeAdminRow[] = raw.map((r) => {
        const o = r as Record<string, unknown>;
        const id = Number(o.id);
        const refRaw = o.stock_ref_count;
        let ref = 0;
        if (typeof refRaw === 'number' && Number.isFinite(refRaw)) ref = Math.max(0, Math.floor(refRaw));
        else ref = Math.max(0, parseInt(String(refRaw ?? '0'), 10) || 0);
        return {
          id: Number.isFinite(id) ? Math.floor(id) : -1,
          category_id: Math.floor(Number(o.category_id) || 0),
          size_label: String(o.size_label ?? '').trim(),
          sort_order: Math.floor(Number(o.sort_order) || 0),
          stock_ref_count: ref,
        };
      });
      setCategorySizeRows(rows.filter((x) => x.id >= 1));
    } catch (err: unknown) {
      console.error('Category sizes load error:', err);
      const m = err instanceof Error ? err.message : 'Unable to load sizes';
      if (m === 'Failed to fetch' || (err instanceof TypeError && err.name === 'TypeError')) {
        setSizesError('Unable to connect to server (is the API running on port 5003?)');
      } else {
        setSizesError(m);
      }
      setCategorySizeRows([]);
    } finally {
      setSizesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === 'sizes') {
      void loadStockClothingTypes();
    }
  }, [activeMenu, loadStockClothingTypes]);

  useEffect(() => {
    if (activeMenu === 'no-size') {
      void loadStockClothingTypes();
    }
  }, [activeMenu, loadStockClothingTypes]);

  useEffect(() => {
    if (activeMenu !== 'sizes') return;
    setSizeEditingId(null);
    const raw = sizesCategoryId.trim();
    if (!raw) {
      setCategorySizeRows([]);
      setSizesLoading(false);
      return;
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) {
      setCategorySizeRows([]);
      return;
    }
    void loadCategorySizesAdmin(id);
  }, [activeMenu, sizesCategoryId, loadCategorySizesAdmin]);

  const loadBrands = useCallback(async () => {
    try {
      setBrandsLoading(true);
      setBrandsError(null);
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to load brands';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as { rows?: ConfigBrandRow[] };
      setBrands(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: unknown) {
      console.error('Brands load error:', err);
      const m = err instanceof Error ? err.message : 'Unable to load brands';
      if (m === 'Failed to fetch' || (err instanceof TypeError && err.name === 'TypeError')) {
        setBrandsError('Unable to connect to server (is the API running on port 5003?)');
      } else {
        setBrandsError(m);
      }
      setBrands([]);
    } finally {
      setBrandsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeMenu === 'brands') {
      void loadBrands();
      void loadClothingCategories();
    }
  }, [activeMenu, loadBrands, loadClothingCategories]);

  useEffect(() => {
    if (activeMenu === 'no-tags') {
      void loadBrands();
    }
  }, [activeMenu, loadBrands]);

  useEffect(() => {
    if (activeMenu === 'duplicate-entries') {
      void loadBrands();
      void loadStockClothingTypes();
    }
  }, [activeMenu, loadBrands, loadStockClothingTypes]);

  useEffect(() => {
    if (activeMenu === 'items-category-check') {
      void loadStockClothingTypes();
    }
  }, [activeMenu, loadStockClothingTypes]);

  const handleBrandsAskAiRank = useCallback(async () => {
    setBrandsError(null);
    if (brands.length === 0) {
      setBrandsAskAiHint(null);
      setBrandsError('Add at least one brand before using Ask AI.');
      return;
    }
    if (brandsAskAiHintTimerRef.current) {
      clearTimeout(brandsAskAiHintTimerRef.current);
      brandsAskAiHintTimerRef.current = null;
    }
    try {
      const prompt = buildBrandsRankByMenswearCategoriesPrompt(brands, clothingCategories);
      await copyConfigPromptToClipboard(prompt);
      setBrandsAskAiHint('Copied to clipboard — paste into ChatGPT or your AI tool.');
      brandsAskAiHintTimerRef.current = setTimeout(() => {
        setBrandsAskAiHint(null);
        brandsAskAiHintTimerRef.current = null;
      }, 5000);
    } catch {
      setBrandsAskAiHint('Could not copy to clipboard.');
    }
  }, [brands, clothingCategories]);

  useEffect(() => {
    return () => {
      if (brandsAskAiHintTimerRef.current) {
        clearTimeout(brandsAskAiHintTimerRef.current);
      }
    };
  }, []);

  const handleBrandAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = brandAddName.trim();
    if (!name) {
      setBrandsError('Brand name is required.');
      return;
    }
    try {
      setBrandAddSaving(true);
      setBrandsError(null);
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_name: name }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to create brand';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      setBrandAddOpen(false);
      setBrandAddName('');
      await loadBrands();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to create brand';
      setBrandsError(m);
    } finally {
      setBrandAddSaving(false);
    }
  };

  const handleStockTypeAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = stockTypeAddName.trim();
    if (!name) {
      setStockTypesError('Category name is required.');
      return;
    }
    try {
      setStockTypeAddSaving(true);
      setStockTypesError(null);
      const response = await fetch(`${API_BASE}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: name }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to create category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      setStockTypeAddOpen(false);
      setStockTypeAddName('');
      await loadStockClothingTypes();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to create category';
      setStockTypesError(m);
    } finally {
      setStockTypeAddSaving(false);
    }
  };

  const cancelStockTypeEdit = () => {
    setStockTypeEditingId(null);
    setStockTypeEditName('');
  };

  const startStockTypeEdit = (row: StockClothingTypeRow) => {
    setStockTypeAddOpen(false);
    setStockTypesError(null);
    setStockTypeEditingId(row.id);
    setStockTypeEditName(row.category_name);
  };

  const handleStockTypeEditSave = async () => {
    if (stockTypeEditingId == null) return;
    const name = stockTypeEditName.trim();
    if (!name) {
      setStockTypesError('Category name is required.');
      return;
    }
    try {
      setStockTypeEditSaving(true);
      setStockTypesError(null);
      const response = await fetch(`${API_BASE}/api/categories/${stockTypeEditingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: name }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to update category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      cancelStockTypeEdit();
      await loadStockClothingTypes();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to update category';
      setStockTypesError(m);
    } finally {
      setStockTypeEditSaving(false);
    }
  };

  const handleStockTypeDelete = async () => {
    if (stockTypeEditingId == null) return;
    const row = stockClothingTypes.find((r) => r.id === stockTypeEditingId);
    if (row && row.stock_count > 0) {
      setStockTypesError(
        `Cannot delete: ${row.stock_count} stock item${row.stock_count === 1 ? '' : 's'} use this category. Reassign them in Stock first.`
      );
      return;
    }
    const label = row?.category_name?.trim() ? row.category_name : `category #${stockTypeEditingId}`;
    if (!window.confirm(`Delete clothing type “${label}”? This cannot be undone.`)) {
      return;
    }
    try {
      setStockTypeDeleteSaving(true);
      setStockTypesError(null);
      const response = await fetch(`${API_BASE}/api/categories/${stockTypeEditingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to delete category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string; stockCount?: number };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      cancelStockTypeEdit();
      await loadStockClothingTypes();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to delete category';
      setStockTypesError(m);
    } finally {
      setStockTypeDeleteSaving(false);
    }
  };

  const cancelBrandEdit = () => {
    setBrandEditingId(null);
    setBrandEditName('');
    setBrandEditWebsite('');
  };

  const startBrandEdit = (b: ConfigBrandRow) => {
    setBrandAddOpen(false);
    setBrandsError(null);
    setBrandEditingId(b.id);
    setBrandEditName(b.brand_name);
    setBrandEditWebsite(b.brand_website?.trim() ?? '');
  };

  const handleBrandEditSave = async () => {
    if (brandEditingId == null) return;
    const name = brandEditName.trim();
    if (!name) {
      setBrandsError('Brand name is required.');
      return;
    }
    const websiteRaw = brandEditWebsite.trim();
    try {
      setBrandEditSaving(true);
      setBrandsError(null);
      const response = await fetch(`${API_BASE}/api/brands/${brandEditingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: name,
          brand_website: websiteRaw.length > 0 ? websiteRaw : null,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to update brand';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      cancelBrandEdit();
      await loadBrands();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to update brand';
      setBrandsError(m);
    } finally {
      setBrandEditSaving(false);
    }
  };

  // Filter rows based on active menu
  const filteredRows = useMemo(() => {
    if (activeMenu === 'untagged-brand') {
      return rows.filter(
        (row) => (row.brand_id === null || row.brand_id === undefined) && !autoTaggedHiddenIds.has(Number(row.id))
      );
    }
    if (activeMenu === 'no-size') {
      return rows.filter(stockRowIsOnNoSizeList);
    }
    if (activeMenu === 'no-ebay-id') {
      return rows.filter(row => !row.ebay_id || row.ebay_id.trim() === '');
    }
    if (activeMenu === 'no-vinted-id') {
      return rows.filter(row => !row.vinted_id || row.vinted_id.trim() === '');
    }
    return [];
  }, [rows, activeMenu, autoTaggedHiddenIds]);

  const duplicateEntryGroups = useMemo(() => {
    const map = new Map<string, StockRow[]>();
    for (const row of rows) {
      const key = stockDuplicateNameKey(row.item_name);
      if (key == null) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    const groups: { normKey: string; displayName: string; rows: StockRow[] }[] = [];
    for (const [normKey, list] of Array.from(map.entries())) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.id - b.id);
      const displayName =
        sorted[0].item_name != null && String(sorted[0].item_name).trim() !== ''
          ? String(sorted[0].item_name).trim()
          : '(unnamed)';
      groups.push({ normKey, displayName, rows: sorted });
    }
    groups.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );
    return groups;
  }, [rows]);

  const noSizePrefetchCategoryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (!stockRowIsOnNoSizeList(row)) continue;
      const cid = row.category_id;
      if (cid == null) continue;
      const n = Number(cid);
      if (Number.isFinite(n) && n >= 1) ids.add(Math.floor(n));
    }
    return Array.from(ids).sort((a, b) => a - b);
  }, [rows]);

  const stockCategoryNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of stockClothingTypes) {
      if (t.id >= 1 && t.category_name) m.set(t.id, t.category_name);
    }
    return m;
  }, [stockClothingTypes]);

  const sortedClothingTypesForCategoryCheck = useMemo(
    () =>
      [...stockClothingTypes].sort((a, b) =>
        a.category_name.localeCompare(b.category_name, undefined, { sensitivity: 'base' })
      ),
    [stockClothingTypes]
  );

  const categoryCheckRows = useMemo(() => {
    if (!categoryCheckCategoryId) return [];
    const cid = Number(categoryCheckCategoryId);
    if (!Number.isFinite(cid)) return [];
    return rows
      .filter((r) => Number(r.category_id) === cid)
      .slice()
      .sort((a, b) => {
        const da = a.purchase_date ? new Date(String(a.purchase_date)).getTime() : 0;
        const db = b.purchase_date ? new Date(String(b.purchase_date)).getTime() : 0;
        if (db !== da) return db - da;
        return (a.item_name ?? '').localeCompare(b.item_name ?? '', undefined, {
          sensitivity: 'base',
        });
      });
  }, [rows, categoryCheckCategoryId]);

  const handleCategoryCheckUpdate = useCallback(async (stockId: number, newCategoryIdStr: string) => {
    const newCat = newCategoryIdStr === '' ? null : Number(newCategoryIdStr);
    if (newCat !== null && (!Number.isFinite(newCat) || newCat < 1)) {
      return;
    }
    setCategoryCheckUpdatingId(stockId);
    setCategoryCheckError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stock/${stockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: newCat }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        row?: StockRow;
        error?: string;
        details?: string;
      };
      if (!res.ok) {
        throw new Error(data.details || data.error || 'Failed to update category');
      }
      const updatedRow = data.row;
      if (!updatedRow) {
        throw new Error('Server did not return the updated row');
      }
      setRows((prev) =>
        prev.map((r) => (Number(r.id) === Number(updatedRow.id) ? updatedRow : r))
      );
    } catch (e: unknown) {
      setCategoryCheckError(e instanceof Error ? e.message : 'Could not update category');
    } finally {
      setCategoryCheckUpdatingId(null);
    }
  }, []);

  useEffect(() => {
    if (activeMenu !== 'no-size') return;
    let cancelled = false;
    if (noSizePrefetchCategoryIds.length === 0) {
      setNoSizePickerSizesByCategory({});
      setNoSizePickerSizesLoading(false);
      setNoSizePickerError(null);
      return;
    }
    setNoSizePickerSizesLoading(true);
    setNoSizePickerError(null);
    void (async () => {
      try {
        const entries = await Promise.all(
          noSizePrefetchCategoryIds.map(async (cid) => {
            const list = await fetchCategorySizesForPicker(cid);
            return [cid, list] as const;
          })
        );
        if (cancelled) return;
        setNoSizePickerSizesByCategory(Object.fromEntries(entries));
      } catch (err: unknown) {
        if (!cancelled) {
          const m = err instanceof Error ? err.message : 'Unable to load size options';
          setNoSizePickerError(m);
          setNoSizePickerSizesByCategory({});
        }
      } finally {
        if (!cancelled) setNoSizePickerSizesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMenu, noSizePrefetchCategoryIds, fetchCategorySizesForPicker]);

  const handleEditItem = (row: StockRow) => {
    window.open(`/stock?editId=${row.id}`, '_blank');
  };

  const handleDuplicateDelete = useCallback(async (row: StockRow) => {
    const label = (row.item_name ?? '').trim() || '(no name)';
    const confirmed = window.confirm(
      `Delete this stock line permanently?\n\nSKU ${row.id}\n${label}\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setDuplicateDeleteId(row.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stock/${row.id}`, { method: 'DELETE' });
      const text = await res.text();
      if (!res.ok) {
        let msg = text || 'Failed to delete';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete stock');
    } finally {
      setDuplicateDeleteId(null);
    }
  }, []);

  const formatBrandTagOptionLabel = (t: BrandTagImageRow): string => {
    const cap = t.caption != null ? String(t.caption).trim() : '';
    if (cap.length > 0) return cap;
    const kind =
      t.image_kind === 'fake_check' ? 'Fake check' : t.image_kind === 'logo' ? 'Logo' : 'Tag';
    return `${kind} #${t.id}`;
  };

  const handleAssignBrandTag = async (stockId: number, tagImageId: number): Promise<boolean> => {
    setAssigningTagStockId(stockId);
    setNoTagsTagError(null);
    try {
      const response = await fetch(`${API_BASE}/api/stock/${stockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_tag_image_id: tagImageId }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to save tag';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      const data = JSON.parse(text) as { row?: Record<string, unknown> };
      const r = data.row;
      if (r && r.id != null) {
        const bt = r.brand_tag_image_id;
        const nextTag =
          bt != null && bt !== undefined && Number(bt) >= 1 ? Math.floor(Number(bt)) : null;
        setRows((prev) =>
          prev.map((row) => (row.id === stockId ? { ...row, brand_tag_image_id: nextTag } : row))
        );
      } else {
        await loadStock();
      }
      return true;
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to save tag';
      setNoTagsTagError(m);
      return false;
    } finally {
      setAssigningTagStockId(null);
    }
  };

  const handleNoSizeAssign = async (stockId: number, categorySizeId: number): Promise<boolean> => {
    setNoSizeAssignSavingId(stockId);
    setError(null);
    setNoSizePickerError(null);
    try {
      const response = await fetch(`${API_BASE}/api/stock/${stockId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_size_id: categorySizeId }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to save size';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      await loadStock();
      return true;
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to save size';
      setNoSizePickerError(m);
      return false;
    } finally {
      setNoSizeAssignSavingId(null);
    }
  };

  const handleAutoTag = async (row: StockRow) => {
    try {
      setAutoTaggingId(row.id);
      setError(null);

      const updateResponse = await fetch(`${API_BASE}/api/stock/${row.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: MISC_BRAND_ID
        }),
      });

      if (!updateResponse.ok) {
        const message = await updateResponse.text();
        throw new Error(message || 'Failed to auto-tag item');
      }

      const normalizedId = Number(row.id);
      setAutoTaggedHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(normalizedId);
        return next;
      });

      // Remove immediately for responsive UX, then refresh from server.
      setRows((prevRows) => prevRows.filter((item) => Number(item.id) !== normalizedId));

      await loadStock();
    } catch (err: any) {
      console.error('AutoTag error:', err);
      setError(err?.message || 'Unable to auto-tag item');
    } finally {
      setAutoTaggingId(null);
    }
  };

  const handleClothingAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = clothingAddName.trim();
    if (!name) {
      setClothingError('Name is required.');
      return;
    }
    try {
      setClothingAddSaving(true);
      setClothingError(null);
      const response = await fetch(`${API_BASE}/api/menswear-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: clothingAddDescription.trim() || undefined,
          notes: clothingAddNotes.trim() || undefined,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to create category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      setClothingAddOpen(false);
      setClothingAddName('');
      setClothingAddDescription('');
      setClothingAddNotes('');
      await loadClothingCategories();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to create category';
      setClothingError(m);
    } finally {
      setClothingAddSaving(false);
    }
  };

  const cancelClothingEdit = () => {
    setClothingEditingId(null);
    setClothingEditName('');
    setClothingEditDescription('');
    setClothingEditNotes('');
  };

  const startClothingEdit = (cat: ClothingCategoryRow) => {
    setClothingAddOpen(false);
    setClothingError(null);
    setClothingEditingId(cat.id);
    setClothingEditName(cat.name);
    setClothingEditDescription(cat.description ?? '');
    setClothingEditNotes(cat.notes ?? '');
  };

  const handleClothingEditSave = async () => {
    if (clothingEditingId == null) return;
    const name = clothingEditName.trim();
    if (!name) {
      setClothingError('Name is required.');
      return;
    }
    try {
      setClothingEditSaving(true);
      setClothingError(null);
      const response = await fetch(`${API_BASE}/api/menswear-categories/${clothingEditingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: clothingEditDescription.trim() || null,
          notes: clothingEditNotes.trim() || null,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to update category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      cancelClothingEdit();
      await loadClothingCategories();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to update category';
      setClothingError(m);
    } finally {
      setClothingEditSaving(false);
    }
  };

  const handleClothingDelete = async () => {
    if (clothingEditingId == null) return;
    const cat = clothingCategories.find((c) => c.id === clothingEditingId);
    const label = cat?.name?.trim() ? cat.name : `category #${clothingEditingId}`;
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) {
      return;
    }
    try {
      setClothingDeleteSaving(true);
      setClothingError(null);
      const response = await fetch(`${API_BASE}/api/menswear-categories/${clothingEditingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to delete category';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      cancelClothingEdit();
      await loadClothingCategories();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Unable to delete category';
      setClothingError(m);
    } finally {
      setClothingDeleteSaving(false);
    }
  };

  const cancelSizeEdit = () => {
    setSizeEditingId(null);
    setSizeEditLabel('');
    setSizeEditSort('');
  };

  const startSizeEdit = (row: CategorySizeAdminRow) => {
    setSizeEditingId(row.id);
    setSizeEditLabel(row.size_label);
    setSizeEditSort(String(row.sort_order));
  };

  const handleSizeAddSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cid = Number(sizesCategoryId);
    if (!Number.isInteger(cid) || cid < 1 || !sizeAddLabel.trim()) return;
    try {
      setSizeAddSaving(true);
      setSizesError(null);
      const body: { category_id: number; size_label: string; sort_order?: number } = {
        category_id: cid,
        size_label: sizeAddLabel.trim(),
      };
      const sortParsed = parseInt(sizeAddSort.trim(), 10);
      if (sizeAddSort.trim() !== '' && Number.isInteger(sortParsed)) {
        body.sort_order = sortParsed;
      }
      const response = await fetch(`${API_BASE}/api/category-sizes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to add size';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      setSizeAddLabel('');
      setSizeAddSort('');
      setSizeAddOpen(false);
      await loadCategorySizesAdmin(cid);
    } catch (err: unknown) {
      setSizesError(err instanceof Error ? err.message : 'Failed to add size');
    } finally {
      setSizeAddSaving(false);
    }
  };

  const handleSizeEditSave = async () => {
    if (sizeEditingId == null) return;
    const sortNum = parseInt(sizeEditSort.trim(), 10);
    if (!Number.isInteger(sortNum)) {
      setSizesError('Sort order must be a whole number.');
      return;
    }
    if (!sizeEditLabel.trim()) {
      setSizesError('Size label cannot be empty.');
      return;
    }
    try {
      setSizeEditSaving(true);
      setSizesError(null);
      const response = await fetch(`${API_BASE}/api/category-sizes/${sizeEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size_label: sizeEditLabel.trim(),
          sort_order: sortNum,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to save size';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      cancelSizeEdit();
      const cid = Number(sizesCategoryId);
      if (Number.isInteger(cid) && cid >= 1) {
        await loadCategorySizesAdmin(cid);
      }
    } catch (err: unknown) {
      setSizesError(err instanceof Error ? err.message : 'Failed to save size');
    } finally {
      setSizeEditSaving(false);
    }
  };

  const handleSizeDelete = async (row: CategorySizeAdminRow) => {
    if (row.stock_ref_count > 0) return;
    const label = row.size_label.trim() || `size #${row.id}`;
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    try {
      setSizeDeleteSaving(true);
      setSizesError(null);
      const response = await fetch(`${API_BASE}/api/category-sizes/${row.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const text = await response.text();
      if (!response.ok) {
        let msg = text || 'Failed to delete size';
        try {
          const j = JSON.parse(text) as { error?: string; details?: string };
          msg = [j.error, j.details].filter(Boolean).join(' — ') || msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      cancelSizeEdit();
      const cid = Number(sizesCategoryId);
      if (Number.isInteger(cid) && cid >= 1) {
        await loadCategorySizesAdmin(cid);
      }
    } catch (err: unknown) {
      setSizesError(err instanceof Error ? err.message : 'Failed to delete size');
    } finally {
      setSizeDeleteSaving(false);
    }
  };

  return (
    <div className="config-container">
      {error &&
        activeMenu !== 'clothing-categories' &&
        activeMenu !== 'clothing-type-categories' &&
        activeMenu !== 'brands' &&
        activeMenu !== 'sizes' && (
        <div className="config-error">{error}</div>
      )}

      <div className="config-layout">
        {/* Sidebar */}
        <div className="config-sidebar">
          <div className="config-sidebar-header">
            <h2>Stock Management</h2>
          </div>
          <nav className="config-sidebar-menu">
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'untagged-brand' ? 'active' : ''}`}
              onClick={() => setActiveMenu('untagged-brand')}
            >
              Items With No Brand
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-tags' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-tags')}
            >
              Items With No Tags
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-size' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-size')}
            >
              Items With No Size
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-ebay-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-ebay-id')}
            >
              Items Not On eBay
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-vinted-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-vinted-id')}
            >
              Items Not On Vinted
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'duplicate-entries' ? 'active' : ''}`}
              onClick={() => setActiveMenu('duplicate-entries')}
            >
              Duplicate entries
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'items-category-check' ? 'active' : ''}`}
              onClick={() => setActiveMenu('items-category-check')}
            >
              Items Category Check
            </button>
            <div
              className="config-sidebar-group"
              role="group"
              aria-labelledby="config-sidebar-category-management-label"
            >
              <div
                id="config-sidebar-category-management-label"
                className="config-sidebar-group-heading"
              >
                Category Management
              </div>
              <button
                type="button"
                className={`config-menu-item config-menu-item--in-group ${
                  activeMenu === 'clothing-type-categories' ? 'active' : ''
                }`}
                onClick={() => setActiveMenu('clothing-type-categories')}
              >
                Clothing Type Categories
              </button>
              <button
                type="button"
                className={`config-menu-item config-menu-item--in-group ${
                  activeMenu === 'clothing-categories' ? 'active' : ''
                }`}
                onClick={() => setActiveMenu('clothing-categories')}
              >
                Menswear Categories
              </button>
              <button
                type="button"
                className={`config-menu-item config-menu-item--in-group ${
                  activeMenu === 'sizes' ? 'active' : ''
                }`}
                onClick={() => setActiveMenu('sizes')}
              >
                Sizes
              </button>
              <button
                type="button"
                className={`config-menu-item config-menu-item--in-group ${
                  activeMenu === 'brands' ? 'active' : ''
                }`}
                onClick={() => setActiveMenu('brands')}
              >
                Brands
              </button>
            </div>
          </nav>
        </div>

        {/* Main Content */}
        <div className="config-content">
          {activeMenu === 'untagged-brand' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found with no brand assigned.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                      </div>
                      <div className="config-grid-item-footer">
                        <button
                          type="button"
                          className="config-grid-autotag-button"
                          onClick={() => handleAutoTag(row)}
                          disabled={autoTaggingId === row.id}
                        >
                          {autoTaggingId === row.id ? 'AutoTagging...' : 'AutoTag'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'no-tags' && (
            <div className="config-section">
              <div className="stock-header config-no-tags-stock-header">
                <div className="header-actions">
                  <div className="stock-filters config-no-tags-stock-filters">
                    <div className="filter-group view-group">
                      <select
                        id="config-no-tags-brand-filter"
                        value={noTagsBrandFilter}
                        onChange={(e) => setNoTagsBrandFilter(e.target.value)}
                        className="filter-select"
                        disabled={brandsLoading}
                        aria-label="Limit list to one brand"
                      >
                        <option value="">All brands</option>
                        {noTagsBrandFilterOptions.map((b) => (
                          <option key={b.id} value={String(b.id)}>
                            {b.brand_name || `Brand #${b.id}`}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="stock-refresh-icon-button"
                        onClick={loadStock}
                        title="Refresh list"
                        aria-label="Refresh list"
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {brandsError ? (
                <div className="config-error config-error--inline" role="alert">
                  {brandsError}
                </div>
              ) : null}
              {noTagsTagError ? (
                <div className="config-error config-error--inline" role="alert">
                  {noTagsTagError}
                </div>
              ) : null}
              {loading || noTagsBrandTagsStillLoading ? (
                <div className="config-loading">Loading...</div>
              ) : noTagsRowsWithoutTag.length === 0 ? (
                <div className="config-empty">No stock items missing a tag.</div>
              ) : noTagsDisplayRows.length === 0 ? (
                <div className="config-empty">
                  No items to show. Untagged lines only appear here when the item has a brand and that
                  brand has at least one tag image (upload tags in Research → Brand).
                </div>
              ) : (
                <div className="config-grid">
                  {noTagsDisplayRows.map((row) => {
                    const bid =
                      row.brand_id != null && Number.isFinite(Number(row.brand_id))
                        ? Math.floor(Number(row.brand_id))
                        : null;
                    const brandLabel =
                      bid != null ? brandNameById.get(bid) ?? `Brand #${bid}` : '—';
                    const cacheEntry = bid != null ? tagImageCache[bid] : undefined;
                    const tagRows = cacheEntry?.state === 'ready' ? cacheEntry.rows : [];
                    return (
                      <div key={row.id} className="config-grid-item">
                        <div className="config-grid-item-header">
                          <span className="config-grid-sku">SKU: {row.id}</span>
                          <button
                            type="button"
                            className="config-grid-edit-button"
                            onClick={() => handleEditItem(row)}
                          >
                            Edit
                          </button>
                        </div>
                        <div className="config-grid-item-body">
                          <div className="config-grid-field">
                            <span className="config-grid-label">Item name</span>
                            <span className="config-grid-value">{row.item_name || '—'}</span>
                          </div>
                          <div className="config-grid-field">
                            <span className="config-grid-label">Brand</span>
                            <span className="config-grid-value">{brandLabel}</span>
                          </div>
                          <label className="new-entry-field stock-new-entry-tags-field config-no-tags-tag-field">
                            <span>Tag</span>
                            <select
                              id={`config-no-tags-sel-${row.id}`}
                              className="new-entry-select"
                              defaultValue=""
                              disabled={assigningTagStockId === row.id}
                              aria-busy={assigningTagStockId === row.id}
                              onChange={async (e) => {
                                const v = e.target.value;
                                const sel = e.target;
                                if (!v || bid == null) return;
                                const tagId = parseInt(v, 10);
                                if (!Number.isInteger(tagId) || tagId < 1) return;
                                const ok = await handleAssignBrandTag(row.id, tagId);
                                if (!ok) sel.value = '';
                              }}
                            >
                              <option value="" disabled>
                                Select tag…
                              </option>
                              {tagRows.map((t) => (
                                <option key={t.id} value={String(t.id)}>
                                  {formatBrandTagOptionLabel(t)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'no-size' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {noSizePickerError ? (
                <div className="config-error config-error--inline" role="alert">
                  {noSizePickerError}
                </div>
              ) : null}
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">
                  No items found without a size (excluding selected clothing-type categories).
                </div>
              ) : (
                <>
                  {noSizePickerSizesLoading ? (
                    <p className="config-no-size-sizes-hint" role="status">
                      Loading size options…
                    </p>
                  ) : null}
                  <div className="config-grid">
                    {filteredRows.map((row) => {
                      const cid =
                        row.category_id != null && Number.isFinite(Number(row.category_id))
                          ? Math.floor(Number(row.category_id))
                          : null;
                      const szList = sortSizePickerOptions(
                        cid != null ? noSizePickerSizesByCategory[cid] ?? [] : []
                      );
                      const categoryLabel =
                        cid != null
                          ? stockCategoryNameById.get(cid) ?? `Category #${cid}`
                          : '—';
                      const canPickSize =
                        cid != null && szList.length > 0 && !noSizePickerSizesLoading;
                      const placeholderLabel =
                        cid == null
                          ? 'Set clothing type on item first'
                          : noSizePickerSizesLoading
                            ? 'Loading sizes…'
                            : szList.length === 0
                              ? 'No sizes for this type — add in Sizes'
                              : 'Select size…';
                      return (
                        <div key={row.id} className="config-grid-item">
                          <div className="config-grid-item-header">
                            <span className="config-grid-sku">SKU: {row.id}</span>
                            <button
                              type="button"
                              className="config-grid-edit-button"
                              onClick={() => handleEditItem(row)}
                            >
                              Edit
                            </button>
                          </div>
                          <div className="config-grid-item-body">
                            <div className="config-grid-field">
                              <span className="config-grid-label">Item Name</span>
                              <span className="config-grid-value">{row.item_name || '—'}</span>
                            </div>
                            <div className="config-grid-field">
                              <span className="config-grid-label">Clothing type</span>
                              <span className="config-grid-value">{categoryLabel}</span>
                            </div>
                            {row.purchase_date && (
                              <div className="config-grid-field">
                                <span className="config-grid-label">Purchase Date</span>
                                <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                              </div>
                            )}
                            <div className="config-grid-field config-grid-field--size-select">
                              <label className="config-grid-label" htmlFor={`config-no-size-sel-${row.id}`}>
                                Size
                              </label>
                              <select
                                id={`config-no-size-sel-${row.id}`}
                                className="config-no-size-select"
                                defaultValue=""
                                disabled={noSizeAssignSavingId === row.id || !canPickSize}
                                aria-busy={noSizeAssignSavingId === row.id}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  if (!v) return;
                                  await handleNoSizeAssign(row.id, Number(v));
                                  e.target.value = '';
                                }}
                              >
                                <option value="">{placeholderLabel}</option>
                                {szList.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.size_label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {activeMenu === 'no-ebay-id' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found that are not on eBay.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                        {row.vinted_id && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Vinted ID</span>
                            <span className="config-grid-value">{row.vinted_id}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'no-vinted-id' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found that are not on Vinted.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                        {row.ebay_id && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">eBay ID</span>
                            <span className="config-grid-value">{row.ebay_id}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'duplicate-entries' && (
            <div className="config-section">
              <div className="config-section-header config-section-header--with-title">
                <h3 className="config-duplicate-page-title">Duplicate entries</h3>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                  aria-label="Refresh duplicate list"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                </button>
              </div>
              <p className="config-duplicate-intro">
                Same item name on more than one stock line (match ignores extra spaces and capitalisation).
                Every duplicate line is shown below — use <strong>Delete</strong> to remove extras after
                confirming.
              </p>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : duplicateEntryGroups.length === 0 ? (
                <div className="config-empty">No duplicate item names found.</div>
              ) : (
                <div className="config-duplicate-groups">
                  {duplicateEntryGroups.map((group) => (
                    <section
                      key={group.normKey}
                      className="config-duplicate-group"
                      aria-label={`Duplicate name: ${group.displayName}`}
                    >
                      <h4 className="config-duplicate-group-title">
                        {group.displayName}
                        <span className="config-duplicate-group-count">
                          {' '}
                          ({group.rows.length} lines)
                        </span>
                      </h4>
                      <div className="config-grid config-duplicate-group-grid">
                        {group.rows.map((row) => {
                          const bid =
                            row.brand_id != null && Number.isFinite(Number(row.brand_id))
                              ? Math.floor(Number(row.brand_id))
                              : null;
                          const brandLabel =
                            bid != null ? brandNameById.get(bid) ?? `Brand #${bid}` : '—';
                          const cid =
                            row.category_id != null && Number.isFinite(Number(row.category_id))
                              ? Math.floor(Number(row.category_id))
                              : null;
                          const catLabel =
                            cid != null
                              ? stockCategoryNameById.get(cid) ?? `Category #${cid}`
                              : '—';
                          return (
                            <div key={row.id} className="config-grid-item">
                              <div className="config-grid-item-header">
                                <span className="config-grid-sku">SKU: {row.id}</span>
                                <button
                                  type="button"
                                  className="config-grid-edit-button"
                                  onClick={() => handleEditItem(row)}
                                >
                                  Edit
                                </button>
                              </div>
                              <div className="config-grid-item-body">
                                <div className="config-grid-field">
                                  <span className="config-grid-label">Item name</span>
                                  <span className="config-grid-value">{row.item_name || '—'}</span>
                                </div>
                                <div className="config-grid-field">
                                  <span className="config-grid-label">Brand</span>
                                  <span className="config-grid-value">{brandLabel}</span>
                                </div>
                                <div className="config-grid-field">
                                  <span className="config-grid-label">Category</span>
                                  <span className="config-grid-value">{catLabel}</span>
                                </div>
                                <div className="config-grid-field">
                                  <span className="config-grid-label">Purchase</span>
                                  <span className="config-grid-value">
                                    {formatCurrency(row.purchase_price)}
                                    {row.purchase_date ? ` · ${formatDate(row.purchase_date)}` : ''}
                                  </span>
                                </div>
                                <div className="config-grid-field">
                                  <span className="config-grid-label">Sale</span>
                                  <span className="config-grid-value">
                                    {row.sale_date
                                      ? `${formatDate(row.sale_date)} · ${formatCurrency(row.sale_price)}`
                                      : 'In stock'}
                                  </span>
                                </div>
                              </div>
                              <div className="config-grid-item-footer">
                                <button
                                  type="button"
                                  className="config-grid-delete-button"
                                  onClick={() => void handleDuplicateDelete(row)}
                                  disabled={duplicateDeleteId === row.id}
                                >
                                  {duplicateDeleteId === row.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'items-category-check' && (
            <div className="config-section">
              <div className="config-section-header config-section-header--with-title">
                <h3 className="config-duplicate-page-title">Items Category Check</h3>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh stock list"
                  aria-label="Refresh stock list"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                </button>
              </div>
              {stockTypesError ? (
                <div className="config-error config-error--inline" role="alert">
                  {stockTypesError}
                </div>
              ) : null}
              <div className="config-sizes-category-picker">
                <div className="config-grid-field config-grid-field--size-select">
                  <label className="config-grid-label" htmlFor="config-items-category-check-filter">
                    Category
                  </label>
                  <select
                    id="config-items-category-check-filter"
                    className="config-no-size-select"
                    value={categoryCheckCategoryId}
                    onChange={(e) => {
                      setCategoryCheckCategoryId(e.target.value);
                      setCategoryCheckError(null);
                    }}
                    disabled={stockTypesLoading && sortedClothingTypesForCategoryCheck.length === 0}
                  >
                    <option value="">
                      {stockTypesLoading && sortedClothingTypesForCategoryCheck.length === 0
                        ? 'Loading categories…'
                        : 'Select a category…'}
                    </option>
                    {sortedClothingTypesForCategoryCheck.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {categoryCheckError ? (
                <div className="config-error config-error--inline" role="alert">
                  {categoryCheckError}
                </div>
              ) : null}
              {categoryCheckCategoryId && loading ? (
                <div className="config-loading">Loading...</div>
              ) : categoryCheckCategoryId && !loading ? (
                categoryCheckRows.length === 0 ? (
                  <div className="config-empty">No items in this category.</div>
                ) : (
                  <div className="config-grid">
                    {categoryCheckRows.map((row) => {
                      const cid =
                        row.category_id != null && Number.isFinite(Number(row.category_id))
                          ? Math.floor(Number(row.category_id))
                          : null;
                      const catName =
                        cid != null ? stockCategoryNameById.get(cid) ?? '—' : '—';
                      return (
                        <div key={row.id} className="config-grid-item">
                          <div className="config-grid-item-header">
                            <span className="config-grid-sku">SKU: {row.id}</span>
                            <button
                              type="button"
                              className="config-grid-edit-button"
                              onClick={() => handleEditItem(row)}
                            >
                              Edit
                            </button>
                          </div>
                          <div className="config-grid-item-body">
                            <div className="config-grid-field">
                              <span className="config-grid-label">Item Name</span>
                              <span className="config-grid-value">{row.item_name?.trim() || '—'}</span>
                            </div>
                            <div className="config-grid-field">
                              <span className="config-grid-label">Clothing type</span>
                              <span className="config-grid-value">{catName}</span>
                            </div>
                            <div className="config-grid-field">
                              <span className="config-grid-label">Purchase Date</span>
                              <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                            </div>
                            <div className="config-grid-field config-grid-field--size-select">
                              <label className="config-grid-label" htmlFor={`config-cat-check-${row.id}`}>
                                Category
                              </label>
                              <select
                                id={`config-cat-check-${row.id}`}
                                className="config-no-size-select"
                                value={row.category_id != null ? String(row.category_id) : ''}
                                disabled={categoryCheckUpdatingId === row.id}
                                aria-busy={categoryCheckUpdatingId === row.id}
                                onChange={(e) => void handleCategoryCheckUpdate(row.id, e.target.value)}
                                aria-label={`Change category for ${row.item_name?.trim() || `item ${row.id}`}`}
                              >
                                <option value="">No category</option>
                                {sortedClothingTypesForCategoryCheck.map((c) => (
                                  <option key={c.id} value={String(c.id)}>
                                    {c.category_name}
                                  </option>
                                ))}
                              </select>
                              {categoryCheckUpdatingId === row.id ? (
                                <p className="config-no-size-sizes-hint" role="status">
                                  Saving…
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : null}
            </div>
          )}

          {activeMenu === 'clothing-type-categories' && (
            <div className="config-section config-section--brands">
              {stockTypesError && <div className="config-error config-error--inline">{stockTypesError}</div>}

              <div className="config-clothing-header">
                <button
                  type="button"
                  className="config-clothing-add-button"
                  onClick={() => {
                    setStockTypesError(null);
                    cancelStockTypeEdit();
                    setStockTypeAddOpen((o) => !o);
                  }}
                  disabled={stockTypeDeleteSaving}
                >
                  {stockTypeAddOpen ? 'Cancel add' : 'Add category'}
                </button>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={() => void loadStockClothingTypes()}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>

              {stockTypeAddOpen && (
                <form className="config-clothing-add-form" onSubmit={handleStockTypeAddSubmit}>
                  <label className="config-clothing-field">
                    <span>Category name *</span>
                    <input
                      type="text"
                      value={stockTypeAddName}
                      onChange={(ev) => setStockTypeAddName(ev.target.value)}
                      placeholder="e.g. Chelsea Boots"
                      maxLength={500}
                      required
                      disabled={stockTypeAddSaving}
                      autoComplete="off"
                    />
                  </label>
                  <div className="config-clothing-add-actions">
                    <button type="submit" className="config-clothing-save-button" disabled={stockTypeAddSaving}>
                      {stockTypeAddSaving ? 'Saving…' : 'Save category'}
                    </button>
                  </div>
                </form>
              )}

              {stockTypesLoading ? (
                <div className="config-loading">Loading clothing types…</div>
              ) : stockTypesError ? null : stockClothingTypes.length === 0 ? (
                <div className="config-empty">No clothing types yet. Use Add category to create one.</div>
              ) : (
                <div className="config-clothing-table-wrap">
                  <table className="config-clothing-table">
                    <thead>
                      <tr>
                        <th scope="col">ID</th>
                        <th scope="col">Name</th>
                        <th scope="col">Stock items</th>
                        <th className="config-clothing-th-actions" scope="col">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockClothingTypes.map((t) =>
                        stockTypeEditingId === t.id ? (
                          <tr key={t.id} className="config-clothing-row-edit">
                            <td colSpan={4}>
                              <div className="config-clothing-inline-edit">
                                <p className="config-brand-edit-id">
                                  <strong>ID</strong> {t.id}
                                  {' · '}
                                  <strong>Stock items</strong> {t.stock_count}
                                </p>
                                <label className="config-clothing-field">
                                  <span>Category name *</span>
                                  <input
                                    type="text"
                                    value={stockTypeEditName}
                                    onChange={(ev) => setStockTypeEditName(ev.target.value)}
                                    maxLength={500}
                                    disabled={stockTypeEditSaving || stockTypeDeleteSaving}
                                    autoComplete="off"
                                  />
                                </label>
                                <div className="config-clothing-inline-edit-actions">
                                  <button
                                    type="button"
                                    className="config-clothing-save-button"
                                    onClick={() => void handleStockTypeEditSave()}
                                    disabled={
                                      stockTypeEditSaving ||
                                      stockTypeDeleteSaving ||
                                      !stockTypeEditName.trim()
                                    }
                                  >
                                    {stockTypeEditSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-cancel-edit-button"
                                    onClick={cancelStockTypeEdit}
                                    disabled={stockTypeEditSaving || stockTypeDeleteSaving}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-delete-category-button"
                                    onClick={() => void handleStockTypeDelete()}
                                    disabled={
                                      stockTypeEditSaving ||
                                      stockTypeDeleteSaving ||
                                      t.stock_count > 0
                                    }
                                    title={
                                      t.stock_count > 0
                                        ? `${t.stock_count} stock item${t.stock_count === 1 ? '' : 's'} use this category — reassign in Stock before deleting`
                                        : 'Delete this clothing type'
                                    }
                                  >
                                    {stockTypeDeleteSaving ? 'Deleting…' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={t.id}>
                            <td>{t.id}</td>
                            <td className="config-clothing-td-name">{t.category_name}</td>
                            <td>{t.stock_count}</td>
                            <td className="config-clothing-td-actions">
                              <button
                                type="button"
                                className="config-clothing-edit-name-button"
                                onClick={() => startStockTypeEdit(t)}
                                disabled={
                                  stockTypeEditSaving || stockTypeAddSaving || stockTypeDeleteSaving
                                }
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeMenu === 'clothing-categories' && (
            <div className="config-section config-section--clothing-categories">
              {clothingError && <div className="config-error config-error--inline">{clothingError}</div>}

              <div className="config-clothing-header">
                <button
                  type="button"
                  className="config-clothing-add-button"
                  onClick={() => {
                    setClothingError(null);
                    cancelClothingEdit();
                    setClothingAddOpen((o) => !o);
                  }}
                  disabled={clothingDeleteSaving}
                >
                  {clothingAddOpen ? 'Cancel add' : 'Add category'}
                </button>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={() => void loadClothingCategories()}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>

              {clothingAddOpen && (
                <form className="config-clothing-add-form" onSubmit={handleClothingAddSubmit}>
                  <label className="config-clothing-field">
                    <span>Name *</span>
                    <input
                      type="text"
                      value={clothingAddName}
                      onChange={(ev) => setClothingAddName(ev.target.value)}
                      placeholder="e.g. Surf wear"
                      maxLength={500}
                      required
                      disabled={clothingAddSaving}
                    />
                  </label>
                  <label className="config-clothing-field">
                    <span>Description</span>
                    <textarea
                      value={clothingAddDescription}
                      onChange={(ev) => setClothingAddDescription(ev.target.value)}
                      placeholder="Short description"
                      rows={2}
                      disabled={clothingAddSaving}
                    />
                  </label>
                  <label className="config-clothing-field">
                    <span>Notes</span>
                    <textarea
                      value={clothingAddNotes}
                      onChange={(ev) => setClothingAddNotes(ev.target.value)}
                      placeholder="Internal notes"
                      rows={2}
                      disabled={clothingAddSaving}
                    />
                  </label>
                  <div className="config-clothing-add-actions">
                    <button type="submit" className="config-clothing-save-button" disabled={clothingAddSaving}>
                      {clothingAddSaving ? 'Saving…' : 'Save category'}
                    </button>
                  </div>
                </form>
              )}

              {clothingLoading ? (
                <div className="config-loading">Loading categories…</div>
              ) : clothingCategories.length === 0 ? (
                <div className="config-empty">No Menswear categories yet. Use Add category to create one.</div>
              ) : (
                <div className="config-clothing-table-wrap">
                  <table className="config-clothing-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Notes</th>
                        <th className="config-clothing-th-actions" scope="col">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {clothingCategories.map((cat) =>
                        clothingEditingId === cat.id ? (
                          <tr key={cat.id} className="config-clothing-row-edit">
                            <td colSpan={4}>
                              <div className="config-clothing-inline-edit">
                                <label className="config-clothing-field">
                                  <span>Name *</span>
                                  <input
                                    type="text"
                                    value={clothingEditName}
                                    onChange={(ev) => setClothingEditName(ev.target.value)}
                                    maxLength={500}
                                    disabled={clothingEditSaving || clothingDeleteSaving}
                                  />
                                </label>
                                <label className="config-clothing-field">
                                  <span>Description</span>
                                  <textarea
                                    value={clothingEditDescription}
                                    onChange={(ev) => setClothingEditDescription(ev.target.value)}
                                    rows={2}
                                    disabled={clothingEditSaving || clothingDeleteSaving}
                                  />
                                </label>
                                <label className="config-clothing-field">
                                  <span>Notes</span>
                                  <textarea
                                    value={clothingEditNotes}
                                    onChange={(ev) => setClothingEditNotes(ev.target.value)}
                                    rows={2}
                                    disabled={clothingEditSaving || clothingDeleteSaving}
                                  />
                                </label>
                                <div className="config-clothing-inline-edit-actions">
                                  <button
                                    type="button"
                                    className="config-clothing-save-button"
                                    onClick={() => void handleClothingEditSave()}
                                    disabled={
                                      clothingEditSaving ||
                                      clothingDeleteSaving ||
                                      !clothingEditName.trim()
                                    }
                                  >
                                    {clothingEditSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-cancel-edit-button"
                                    onClick={cancelClothingEdit}
                                    disabled={clothingEditSaving || clothingDeleteSaving}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-delete-category-button"
                                    onClick={() => void handleClothingDelete()}
                                    disabled={clothingEditSaving || clothingDeleteSaving}
                                  >
                                    {clothingDeleteSaving ? 'Deleting…' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={cat.id}>
                            <td className="config-clothing-td-name">{cat.name}</td>
                            <td>{cat.description?.trim() ? cat.description : '—'}</td>
                            <td>{cat.notes?.trim() ? cat.notes : '—'}</td>
                            <td className="config-clothing-td-actions">
                              <button
                                type="button"
                                className="config-clothing-edit-name-button"
                                onClick={() => startClothingEdit(cat)}
                                disabled={
                                  clothingEditSaving || clothingAddSaving || clothingDeleteSaving
                                }
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeMenu === 'brands' && (
            <div className="config-section config-section--brands">
              {brandsError && <div className="config-error config-error--inline">{brandsError}</div>}

              <div className="config-clothing-header">
                <button
                  type="button"
                  className="config-clothing-add-button"
                  onClick={() => {
                    setBrandsError(null);
                    cancelBrandEdit();
                    setBrandAddOpen((o) => !o);
                  }}
                >
                  {brandAddOpen ? 'Cancel add' : 'Add New Brand'}
                </button>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={() => void loadBrands()}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>

              {brandAddOpen && (
                <form className="config-clothing-add-form" onSubmit={handleBrandAddSubmit}>
                  <label className="config-clothing-field">
                    <span>Brand name *</span>
                    <input
                      type="text"
                      value={brandAddName}
                      onChange={(ev) => setBrandAddName(ev.target.value)}
                      placeholder="e.g. Barbour"
                      maxLength={500}
                      required
                      disabled={brandAddSaving}
                      autoComplete="off"
                    />
                  </label>
                  <div className="config-clothing-add-actions">
                    <button type="submit" className="config-clothing-save-button" disabled={brandAddSaving}>
                      {brandAddSaving ? 'Saving…' : 'Save brand'}
                    </button>
                  </div>
                </form>
              )}

              {brandsLoading ? (
                <div className="config-loading">Loading brands…</div>
              ) : brandsError ? null : brands.length === 0 ? (
                <div className="config-empty">No brands in the database yet. Use Add New Brand to create one.</div>
              ) : (
                <div className="config-clothing-table-wrap">
                  <table className="config-clothing-table">
                    <thead>
                      <tr>
                        <th scope="col">ID</th>
                        <th scope="col">Name</th>
                        <th scope="col">Website</th>
                        <th className="config-clothing-th-actions" scope="col">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {brands.map((b) =>
                        brandEditingId === b.id ? (
                          <tr key={b.id} className="config-clothing-row-edit">
                            <td colSpan={4}>
                              <div className="config-clothing-inline-edit">
                                <p className="config-brand-edit-id">
                                  <strong>ID</strong> {b.id}
                                </p>
                                <label className="config-clothing-field">
                                  <span>Brand name *</span>
                                  <input
                                    type="text"
                                    value={brandEditName}
                                    onChange={(ev) => setBrandEditName(ev.target.value)}
                                    maxLength={500}
                                    disabled={brandEditSaving}
                                    autoComplete="off"
                                  />
                                </label>
                                <label className="config-clothing-field">
                                  <span>Website (link)</span>
                                  <input
                                    type="text"
                                    value={brandEditWebsite}
                                    onChange={(ev) => setBrandEditWebsite(ev.target.value)}
                                    placeholder="https://…"
                                    maxLength={2048}
                                    disabled={brandEditSaving}
                                    autoComplete="off"
                                  />
                                </label>
                                <div className="config-clothing-inline-edit-actions">
                                  <button
                                    type="button"
                                    className="config-clothing-save-button"
                                    onClick={() => void handleBrandEditSave()}
                                    disabled={brandEditSaving || !brandEditName.trim()}
                                  >
                                    {brandEditSaving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-cancel-edit-button"
                                    onClick={cancelBrandEdit}
                                    disabled={brandEditSaving}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={b.id}>
                            <td>{b.id}</td>
                            <td className="config-clothing-td-name">{b.brand_name}</td>
                            <td>
                              {b.brand_website?.trim() ? (
                                <a
                                  href={
                                    b.brand_website?.startsWith('http')
                                      ? b.brand_website
                                      : `https://${b.brand_website}`
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="config-brand-website-link"
                                >
                                  {b.brand_website}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="config-clothing-td-actions">
                              <button
                                type="button"
                                className="config-clothing-edit-name-button"
                                onClick={() => startBrandEdit(b)}
                                disabled={brandEditSaving || brandAddSaving}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="config-brands-ask-ai-footer">
                <button
                  type="button"
                  className="config-brands-ask-ai-button"
                  onClick={() => void handleBrandsAskAiRank()}
                  disabled={brandsLoading || brands.length === 0}
                  title="Build a prompt with every brand and your menswear categories, copy to clipboard"
                >
                  Ask AI — rank brands by menswear categories
                </button>
                {brandsAskAiHint ? (
                  <p className="config-brands-ask-ai-hint" role="status">
                    {brandsAskAiHint}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {activeMenu === 'sizes' && (
            <div className="config-section config-section--sizes">
              {sizesError && <div className="config-error config-error--inline">{sizesError}</div>}
              <div className="config-clothing-header">
                <h3 className="config-section-title">Stock sizes by clothing type</h3>
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={() => {
                    const cid = Number(sizesCategoryId);
                    if (Number.isInteger(cid) && cid >= 1) void loadCategorySizesAdmin(cid);
                    void loadStockClothingTypes();
                  }}
                  title="Refresh categories and sizes"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                </button>
              </div>
              <p className="config-sizes-intro">
                Choose a <strong>clothing type category</strong> (same list as Stock). Add or edit size labels for that
                category. Delete is only allowed when no stock line uses that size.
              </p>
              <label className="config-clothing-field config-sizes-category-picker">
                <span>Category</span>
                <select
                  value={sizesCategoryId}
                  onChange={(ev) => {
                    setSizesCategoryId(ev.target.value);
                    setSizesError(null);
                  }}
                  disabled={stockTypesLoading}
                >
                  <option value="">Select category…</option>
                  {stockClothingTypes.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.category_name}
                    </option>
                  ))}
                </select>
              </label>

              {!sizesCategoryId.trim() ? (
                <div className="config-empty">Select a category to manage sizes.</div>
              ) : (
                <>
                  <div className="config-clothing-header config-sizes-add-row">
                    <button
                      type="button"
                      className="config-clothing-add-button"
                      onClick={() => {
                        setSizeAddOpen((o) => !o);
                        setSizeAddLabel('');
                        setSizeAddSort('');
                        setSizesError(null);
                      }}
                      disabled={sizeAddSaving || sizeEditSaving}
                    >
                      {sizeAddOpen ? 'Close add form' : 'Add size'}
                    </button>
                  </div>
                  {sizeAddOpen && (
                    <form className="config-clothing-add-form config-sizes-add-form" onSubmit={handleSizeAddSubmit}>
                      <label className="config-clothing-field">
                        <span>Size label</span>
                        <input
                          type="text"
                          value={sizeAddLabel}
                          onChange={(ev) => setSizeAddLabel(ev.target.value)}
                          placeholder="e.g. Medium, 42R, 34W"
                          maxLength={120}
                          disabled={sizeAddSaving}
                          autoComplete="off"
                        />
                      </label>
                      <label className="config-clothing-field">
                        <span>Sort order (optional)</span>
                        <input
                          type="number"
                          step={1}
                          value={sizeAddSort}
                          onChange={(ev) => setSizeAddSort(ev.target.value)}
                          placeholder="Auto if empty"
                          disabled={sizeAddSaving}
                        />
                      </label>
                      <div className="config-clothing-add-actions">
                        <button type="submit" className="config-clothing-save-button" disabled={sizeAddSaving || !sizeAddLabel.trim()}>
                          {sizeAddSaving ? 'Saving…' : 'Save size'}
                        </button>
                      </div>
                    </form>
                  )}

                  {sizesLoading ? (
                    <div className="config-loading">Loading sizes…</div>
                  ) : categorySizeRows.length === 0 ? (
                    <div className="config-empty">No sizes for this category yet. Use Add size to create one.</div>
                  ) : (
                    <div className="config-clothing-table-wrap">
                      <table className="config-clothing-table config-sizes-table">
                        <thead>
                          <tr>
                            <th scope="col">Label</th>
                            <th scope="col">Sort</th>
                            <th scope="col">Stock items</th>
                            <th className="config-clothing-th-actions" scope="col">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {categorySizeRows.map((row) =>
                            sizeEditingId === row.id ? (
                              <tr key={row.id} className="config-clothing-row-edit">
                                <td colSpan={4}>
                                  <div className="config-clothing-inline-edit">
                                    <p className="config-brand-edit-id">Size id: {row.id}</p>
                                    <label className="config-clothing-field">
                                      <span>Size label</span>
                                      <input
                                        type="text"
                                        value={sizeEditLabel}
                                        onChange={(ev) => setSizeEditLabel(ev.target.value)}
                                        maxLength={120}
                                        disabled={sizeEditSaving}
                                        autoComplete="off"
                                      />
                                    </label>
                                    <label className="config-clothing-field">
                                      <span>Sort order</span>
                                      <input
                                        type="number"
                                        step={1}
                                        value={sizeEditSort}
                                        onChange={(ev) => setSizeEditSort(ev.target.value)}
                                        disabled={sizeEditSaving}
                                      />
                                    </label>
                                    <div className="config-clothing-inline-edit-actions">
                                      <button
                                        type="button"
                                        className="config-clothing-save-button"
                                        onClick={() => void handleSizeEditSave()}
                                        disabled={sizeEditSaving || !sizeEditLabel.trim()}
                                      >
                                        {sizeEditSaving ? 'Saving…' : 'Save'}
                                      </button>
                                      <button
                                        type="button"
                                        className="config-clothing-cancel-edit-button"
                                        onClick={cancelSizeEdit}
                                        disabled={sizeEditSaving}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className="config-clothing-delete-category-button"
                                        onClick={() => void handleSizeDelete(row)}
                                        disabled={
                                          sizeEditSaving ||
                                          sizeDeleteSaving ||
                                          row.stock_ref_count > 0
                                        }
                                        title={
                                          row.stock_ref_count > 0
                                            ? `${row.stock_ref_count} stock item(s) use this size — clear them before deleting.`
                                            : 'Delete this size'
                                        }
                                      >
                                        {sizeDeleteSaving ? '…' : 'Delete'}
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              <tr key={row.id}>
                                <td className="config-clothing-td-name">{row.size_label}</td>
                                <td>{row.sort_order}</td>
                                <td>{row.stock_ref_count}</td>
                                <td className="config-clothing-td-actions">
                                  <button
                                    type="button"
                                    className="config-clothing-edit-name-button"
                                    onClick={() => startSizeEdit(row)}
                                    disabled={sizeEditSaving || sizeAddSaving || sizeDeleteSaving}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="config-clothing-delete-category-button config-sizes-delete-inline"
                                    onClick={() => void handleSizeDelete(row)}
                                    disabled={sizeDeleteSaving || row.stock_ref_count > 0 || sizeEditingId !== null}
                                    title={
                                      row.stock_ref_count > 0
                                        ? `${row.stock_ref_count} stock item(s) use this size — cannot delete.`
                                        : 'Delete size'
                                    }
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Config;
