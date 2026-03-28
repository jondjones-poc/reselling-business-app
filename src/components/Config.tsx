import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApiBase } from '../utils/apiBase';
import './Config.css';

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
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

const MISC_BRAND_ID = 39;

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
  | 'no-ebay-id'
  | 'no-vinted-id'
  | 'clothing-type-categories'
  | 'clothing-categories'
  | 'brands';

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
    if (activeMenu === 'no-ebay-id') {
      return rows.filter(row => !row.ebay_id || row.ebay_id.trim() === '');
    }
    if (activeMenu === 'no-vinted-id') {
      return rows.filter(row => !row.vinted_id || row.vinted_id.trim() === '');
    }
    return [];
  }, [rows, activeMenu, autoTaggedHiddenIds]);

  const handleEditItem = (row: StockRow) => {
    window.open(`/stock?editId=${row.id}`, '_blank');
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

  return (
    <div className="config-container">
      {error &&
        activeMenu !== 'clothing-categories' &&
        activeMenu !== 'clothing-type-categories' &&
        activeMenu !== 'brands' && (
        <div className="config-error">{error}</div>
      )}

      <div className="config-layout">
        {/* Sidebar */}
        <div className="config-sidebar">
          <div className="config-sidebar-header">
            <h2>Settings</h2>
          </div>
          <nav className="config-sidebar-menu">
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'untagged-brand' ? 'active' : ''}`}
              onClick={() => setActiveMenu('untagged-brand')}
            >
              UnTagged Brand
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-ebay-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-ebay-id')}
            >
              No eBay ID
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-vinted-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-vinted-id')}
            >
              No Vinted ID
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'clothing-type-categories' ? 'active' : ''}`}
              onClick={() => setActiveMenu('clothing-type-categories')}
            >
              Clothing type categories
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'clothing-categories' ? 'active' : ''}`}
              onClick={() => setActiveMenu('clothing-categories')}
            >
              Menswear Categories
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'brands' ? 'active' : ''}`}
              onClick={() => setActiveMenu('brands')}
            >
              Brands
            </button>
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
                <div className="config-empty">No items found without a brand assigned.</div>
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
                <div className="config-empty">No items found without an eBay ID.</div>
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
                <div className="config-empty">No items found without a Vinted ID.</div>
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

              <p className="config-stock-types-hint">
                Rows come from the <strong>category</strong> database table (same types as Stock and eBay search). You
                can only delete a type when no stock lines reference it.
              </p>

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
                <p className="config-brands-ask-ai-explainer">
                  Creates a prompt listing all brands and your Menswear categories (name, description, notes), and asks
                  the model to rank brands per category and overall for UK resale.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Config;
