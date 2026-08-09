import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import { themeAccentRgba, themeTextRgba } from '../utils/themeColors';
import './InventoryAgeing.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function apiUrl(path: string): string {
  const base = getApiBase().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function formatGbp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

function formatDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = Math.round(value);
  return `${n} day${n === 1 ? '' : 's'}`;
}

type AgeingWarning = 'healthy' | 'watch' | 'slow' | 'stale';

type AgeingBand = {
  key: string;
  label: string;
  minDays: number;
  maxDays: number | null;
  warning: AgeingWarning;
  itemCount: number;
  purchaseTotal: number;
  avgPurchaseCost: number | null;
  avgAskingPrice: number | null;
  pctOfItems: number;
  pctOfCapital: number;
};

type AgeingTotals = {
  itemCount: number;
  purchaseTotal: number;
  avgAgeDays: number | null;
  medianAgeDays: number | null;
  oldestAgeDays: number | null;
  oldestPurchaseDate: string | null;
  newestPurchaseDate: string | null;
  missingPurchaseDateCount: number;
};

type StorageTotals = AgeingTotals & {
  ebayDraftCount: number;
  fullyUnlistedCount: number;
  withAskingPriceCount: number;
  askingTotal: number;
};

type StorageCategoryRow = {
  categoryId: number | null;
  categoryName: string;
  itemCount: number;
  purchaseTotal: number;
};

type AgeingItemRow = {
  id: number;
  itemName: string;
  purchaseDate: string | null;
  daysInStock: number | null;
  purchasePrice: number | null;
  projectedSalePrice: number | null;
  brandId: number | null;
  brandName: string;
  categoryId: number | null;
  categoryName: string;
  vintedId: string | null;
  ebayId: string | null;
  depopId: string | null;
};

type FilterOption = { id: number; name: string };

type ChartMetric = 'items' | 'capital';
type PlatformFilter = 'all' | 'vinted' | 'ebay' | 'depop';
type ListingScope = 'live' | 'storage';

const WARNING_LABEL: Record<AgeingWarning, string> = {
  healthy: 'Healthy (0–90 days)',
  watch: 'Watch (91–180 days)',
  slow: 'Slow (181–365 days)',
  stale: 'Stale (365+ days)',
};

async function readJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; details?: string };
      detail = body.details || body.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Failed to load ${label} (${res.status})`);
  }
  return (await res.json()) as T;
}

async function copyTextToClipboard(text: string): Promise<void> {
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

function buildInventoryAgeingAskAiPrompt(args: {
  filters: {
    department: string;
    category: string;
    brand: string;
    platform: string;
  };
  totals: AgeingTotals;
  bands: AgeingBand[];
  storageTotals: StorageTotals | null;
  storageBands: AgeingBand[];
  storageCategories: StorageCategoryRow[];
  selectedBand: AgeingBand | null;
  selectedScope: ListingScope;
  selectedItems: AgeingItemRow[];
}): string {
  const {
    filters,
    totals,
    bands,
    storageTotals,
    storageBands,
    storageCategories,
    selectedBand,
    selectedScope,
    selectedItems,
  } = args;
  const lines: string[] = [
    `I'm a UK second-hand / resale seller (Vinted + eBay). I want **objective, practical** advice — do **not** just agree with me or soft-pedal. Challenge weak assumptions and say when the sample is thin.`,
    ``,
    `I hold a lot of **seasonal** stock in storage (summer vs winter). Live ageing below is only Vinted and/or live eBay — not storage and not eBay drafts. Storage is unlisted or eBay-draft stock held for the right season. Age is days since **purchase date**. Capital = purchase cost still tied up.`,
    ``,
    `## Current filters`,
    `- Department: ${filters.department}`,
    `- Stock category / clothing type: ${filters.category}`,
    `- Brand: ${filters.brand}`,
    `- Live platform filter: ${filters.platform}`,
    ``,
    `## Live listed unsold stock`,
    `- Live unsold items: ${totals.itemCount}`,
    `- Capital tied up (live): ${formatGbp(totals.purchaseTotal)}`,
    `- Average age: ${formatDays(totals.avgAgeDays)}`,
    `- Median age: ${formatDays(totals.medianAgeDays)}`,
    `- Oldest unsold: ${formatDays(totals.oldestAgeDays)}`,
    totals.missingPurchaseDateCount > 0
      ? `- Live items missing purchase date (excluded from bands): ${totals.missingPurchaseDateCount}`
      : null,
    ``,
    `## Live age bands`,
    ``,
  ].filter((line): line is string => line != null);

  bands.forEach((b) => {
    lines.push(
      `### ${b.label} (${WARNING_LABEL[b.warning]})`,
      `- Items: ${b.itemCount} (${formatPct(b.pctOfItems)} of live)`,
      `- Capital: ${formatGbp(b.purchaseTotal)} (${formatPct(b.pctOfCapital)} of live capital)`,
      `- Avg buy: ${formatGbp(b.avgPurchaseCost)} · Avg ask: ${formatGbp(b.avgAskingPrice)}`,
      ``
    );
  });

  if (storageTotals) {
    lines.push(
      `## Storage / unlisted (seasonal hold)`,
      `- Storage items: ${storageTotals.itemCount}`,
      `- Capital in storage: ${formatGbp(storageTotals.purchaseTotal)}`,
      `- eBay drafts: ${storageTotals.ebayDraftCount}`,
      `- Fully unlisted (no Vinted + no eBay): ${storageTotals.fullyUnlistedCount}`,
      `- With asking price: ${storageTotals.withAskingPriceCount} · ask total ${formatGbp(storageTotals.askingTotal)}`,
      `- Average age in storage: ${formatDays(storageTotals.avgAgeDays)}`,
      `- Median age in storage: ${formatDays(storageTotals.medianAgeDays)}`,
      ``,
      `## Storage age bands`,
      ``
    );
    storageBands.forEach((b) => {
      lines.push(
        `### ${b.label}`,
        `- Items: ${b.itemCount} (${formatPct(b.pctOfItems)}) · Capital: ${formatGbp(b.purchaseTotal)} (${formatPct(b.pctOfCapital)})`,
        ``
      );
    });
    if (storageCategories.length > 0) {
      lines.push(`## Top storage categories by capital`, ``);
      storageCategories.slice(0, 8).forEach((c, i) => {
        lines.push(
          `${i + 1}. ${c.categoryName}: ${c.itemCount} items · ${formatGbp(c.purchaseTotal)}`
        );
      });
      lines.push(``);
    }
  }

  if (selectedBand) {
    lines.push(
      `## Currently opened band (${selectedScope}): ${selectedBand.label}`,
      `- ${selectedBand.itemCount} items · ${formatGbp(selectedBand.purchaseTotal)} capital`,
      ``
    );
    if (selectedItems.length > 0) {
      lines.push(`### Sample items in this band (up to ${selectedItems.length})`, ``);
      selectedItems.slice(0, 40).forEach((row, i) => {
        lines.push(
          `${i + 1}. **${row.itemName}** — ${row.brandName} / ${row.categoryName} · age ${formatDays(
            row.daysInStock
          )} · buy ${formatGbp(row.purchasePrice)} · ask ${formatGbp(row.projectedSalePrice)} · bought ${
            row.purchaseDate ?? '—'
          }`
        );
      });
      lines.push(``);
    }
  }

  lines.push(
    `## What I need from you`,
    `1. **Live vs storage** — How healthy is live ageing once storage is separated? What should I list next for the current season vs keep stored?`,
    `2. **What I should do** — Prioritise by age band and capital. Clear first vs hold for seasonality. Be specific to the numbers.`,
    `3. **How to sell live stock quickly on Vinted and eBay** — Listing, pricing, photos, shipping, bundling for UK buyers. Different tactics for fresh vs Watch / Slow / Stale.`,
    `4. **Ideas I might not have thought of** — Seasonal rotate-in plans, channel mix, when to cut loss, sourcing changes.`,
    ``,
    `Tone: direct, practical UK reseller advice. Work from the data; say when history is too thin to over-interpret.`,
    `Today’s date context: ${new Date().toISOString().slice(0, 10)}.`
  );

  return lines.join('\n');
}

const InventoryAgeing: React.FC = () => {
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [brandId, setBrandId] = useState<number | ''>('');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('items');

  const [departments, setDepartments] = useState<FilterOption[]>([]);
  const [categories, setCategories] = useState<FilterOption[]>([]);
  const [brands, setBrands] = useState<FilterOption[]>([]);

  const [bands, setBands] = useState<AgeingBand[]>([]);
  const [totals, setTotals] = useState<AgeingTotals | null>(null);
  const [storageBands, setStorageBands] = useState<AgeingBand[]>([]);
  const [storageTotals, setStorageTotals] = useState<StorageTotals | null>(null);
  const [storageCategories, setStorageCategories] = useState<StorageCategoryRow[]>([]);
  const [storageChartMetric, setStorageChartMetric] = useState<ChartMetric>('capital');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedBand, setSelectedBand] = useState<string | null>(null);
  const [drilldownScope, setDrilldownScope] = useState<ListingScope>('live');
  const [bandItems, setBandItems] = useState<AgeingItemRow[]>([]);
  const [bandItemsLoading, setBandItemsLoading] = useState(false);
  const [bandItemsError, setBandItemsError] = useState<string | null>(null);
  const [askAiBusy, setAskAiBusy] = useState(false);
  const [askAiHint, setAskAiHint] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/departments'), { signal: ac.signal });
        const data = await readJson<{
          rows?: { id?: unknown; department_name?: unknown }[];
          departments?: { id?: unknown; department_name?: unknown }[];
        }>(res, 'departments');
        const raw = Array.isArray(data.rows)
          ? data.rows
          : Array.isArray(data.departments)
            ? data.departments
            : [];
        const mapped = raw
          .map((r) => {
            const id = Number(r.id);
            if (!Number.isFinite(id) || id < 1) return null;
            return {
              id,
              name: String(r.department_name ?? '').trim() || `Department #${id}`,
            };
          })
          .filter((x): x is FilterOption => x != null)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        setDepartments(mapped);
        setDepartmentId((prev) => {
          if (prev !== '') return prev;
          const mw = mapped.find((d) => d.name.toLowerCase() === 'menswear');
          return mw?.id ?? mapped[0]?.id ?? '';
        });
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setDepartments([]);
      }
    })();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const qs =
          departmentId === ''
            ? ''
            : `?department_id=${encodeURIComponent(String(departmentId))}`;
        const res = await fetch(apiUrl(`/api/categories${qs}`), { signal: ac.signal });
        const data = await readJson<{ rows?: { id?: unknown; category_name?: unknown }[] }>(
          res,
          'categories'
        );
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setCategories(
          raw
            .map((r) => {
              const id = Number(r.id);
              if (!Number.isFinite(id) || id < 1) return null;
              return {
                id,
                name: String(r.category_name ?? '').trim() || `Category #${id}`,
              };
            })
            .filter((x): x is FilterOption => x != null)
        );
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setCategories([]);
      }
    })();
    return () => ac.abort();
  }, [departmentId]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/brands'), { signal: ac.signal });
        const data = await readJson<{
          rows?: { id?: unknown; brand_name?: unknown; department_id?: unknown }[];
        }>(res, 'brands');
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setBrands(
          raw
            .map((r) => {
              const id = Number(r.id);
              if (!Number.isFinite(id) || id < 1) return null;
              const dept = r.department_id != null ? Number(r.department_id) : null;
              if (departmentId !== '' && dept !== departmentId) return null;
              return {
                id,
                name: String(r.brand_name ?? '').trim() || `Brand #${id}`,
              };
            })
            .filter((x): x is FilterOption => x != null)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        );
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setBrands([]);
      }
    })();
    return () => ac.abort();
  }, [departmentId]);

  useEffect(() => {
    setCategoryId('');
    setBrandId('');
    setSelectedBand(null);
  }, [departmentId]);

  useEffect(() => {
    setSelectedBand(null);
  }, [categoryId, brandId, platform]);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (departmentId !== '') qs.set('department_id', String(departmentId));
    if (categoryId !== '') qs.set('category_id', String(categoryId));
    if (brandId !== '') qs.set('brand_id', String(brandId));
    if (platform !== 'all') qs.set('platform', platform);
    const s = qs.toString();
    return s ? `?${s}` : '';
  }, [departmentId, categoryId, brandId, platform]);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/api/stock/inventory-ageing${queryString}`), {
          signal: ac.signal,
        });
        const data = await readJson<{
          bands?: AgeingBand[];
          totals?: AgeingTotals;
          storage?: {
            bands?: AgeingBand[];
            totals?: StorageTotals;
            byCategory?: StorageCategoryRow[];
          };
        }>(res, 'inventory ageing');
        setBands(Array.isArray(data.bands) ? data.bands : []);
        setTotals(data.totals ?? null);
        const storageBandsRaw = data.storage?.bands;
        const storageCategoriesRaw = data.storage?.byCategory;
        setStorageBands(Array.isArray(storageBandsRaw) ? storageBandsRaw : []);
        setStorageTotals(data.storage?.totals ?? null);
        setStorageCategories(Array.isArray(storageCategoriesRaw) ? storageCategoriesRaw : []);
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setBands([]);
        setTotals(null);
        setStorageBands([]);
        setStorageTotals(null);
        setStorageCategories([]);
        setError(e instanceof Error ? e.message : 'Failed to load inventory ageing');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [queryString]);

  useEffect(() => {
    if (!selectedBand) {
      setBandItems([]);
      setBandItemsError(null);
      return;
    }
    const ac = new AbortController();
    void (async () => {
      setBandItemsLoading(true);
      setBandItemsError(null);
      try {
        const qs = new URLSearchParams();
        qs.set('band', selectedBand);
        qs.set('scope', drilldownScope);
        if (departmentId !== '') qs.set('department_id', String(departmentId));
        if (categoryId !== '') qs.set('category_id', String(categoryId));
        if (brandId !== '') qs.set('brand_id', String(brandId));
        if (drilldownScope === 'live' && platform !== 'all') qs.set('platform', platform);
        qs.set('limit', '500');
        const res = await fetch(apiUrl(`/api/stock/inventory-ageing/items?${qs}`), {
          signal: ac.signal,
        });
        const data = await readJson<{ rows?: AgeingItemRow[] }>(res, 'ageing band items');
        setBandItems(Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setBandItems([]);
        setBandItemsError(e instanceof Error ? e.message : 'Failed to load items');
      } finally {
        if (!ac.signal.aborted) setBandItemsLoading(false);
      }
    })();
    return () => ac.abort();
  }, [selectedBand, drilldownScope, departmentId, categoryId, brandId, platform]);

  const selectedBandMeta = useMemo(() => {
    const sourceBands = drilldownScope === 'storage' ? storageBands : bands;
    if (selectedBand === 'missing-date' && totals && drilldownScope === 'live') {
      return {
        key: 'missing-date',
        label: 'Missing purchase date',
        minDays: 0,
        maxDays: null,
        warning: 'watch' as AgeingWarning,
        itemCount: totals.missingPurchaseDateCount,
        purchaseTotal: 0,
        avgPurchaseCost: null,
        avgAskingPrice: null,
        pctOfItems: 0,
        pctOfCapital: 0,
      };
    }
    return sourceBands.find((b) => b.key === selectedBand) ?? null;
  }, [bands, storageBands, selectedBand, totals, drilldownScope]);
  const showDrilldown = selectedBand != null && (selectedBandMeta != null || selectedBand === 'missing-date');

  const filterLabels = useMemo(() => {
    const department =
      departmentId === ''
        ? 'All departments'
        : departments.find((d) => d.id === departmentId)?.name ?? `Department #${departmentId}`;
    const category =
      categoryId === ''
        ? 'All types'
        : categories.find((c) => c.id === categoryId)?.name ?? `Category #${categoryId}`;
    const brand =
      brandId === ''
        ? 'All brands'
        : brands.find((b) => b.id === brandId)?.name ?? `Brand #${brandId}`;
    const platformLabel =
      platform === 'all'
        ? 'All live platforms'
        : platform === 'vinted'
          ? 'Vinted listed'
          : platform === 'ebay'
            ? 'eBay listed'
            : 'Depop listed';
    return { department, category, brand, platform: platformLabel };
  }, [departmentId, categoryId, brandId, platform, departments, categories, brands]);

  const runAskAi = useCallback(async () => {
    if (!totals || bands.length === 0) {
      setAskAiHint('Load ageing data first.');
      window.setTimeout(() => setAskAiHint(null), 4500);
      return;
    }
    setAskAiBusy(true);
    setAskAiHint(null);
    try {
      const text = buildInventoryAgeingAskAiPrompt({
        filters: filterLabels,
        totals,
        bands,
        storageTotals,
        storageBands,
        storageCategories,
        selectedBand: selectedBandMeta,
        selectedScope: drilldownScope,
        selectedItems: showDrilldown ? bandItems : [],
      });
      await copyTextToClipboard(text);
      setAskAiHint('Copied to clipboard — paste into ChatGPT.');
    } catch (e) {
      setAskAiHint(e instanceof Error ? e.message : 'Could not copy prompt');
    } finally {
      setAskAiBusy(false);
      window.setTimeout(() => setAskAiHint(null), 5000);
    }
  }, [
    totals,
    bands,
    storageTotals,
    storageBands,
    storageCategories,
    filterLabels,
    selectedBandMeta,
    drilldownScope,
    bandItems,
    showDrilldown,
  ]);

  const chartData = useMemo(() => {
    const labels = bands.map((b) => b.label);
    const values =
      chartMetric === 'items'
        ? bands.map((b) => b.itemCount)
        : bands.map((b) => Math.round(b.purchaseTotal * 100) / 100);
    const colors = bands.map((b) => {
      switch (b.warning) {
        case 'healthy':
          return 'rgba(34, 197, 94, 0.78)';
        case 'watch':
          return 'rgba(234, 179, 8, 0.82)';
        case 'slow':
          return 'rgba(249, 115, 22, 0.82)';
        case 'stale':
          return 'rgba(239, 68, 68, 0.82)';
        default:
          return themeAccentRgba(0.55);
      }
    });
    return {
      labels,
      datasets: [
        {
          label: chartMetric === 'items' ? 'Live listed items' : 'Live capital (£)',
          data: values,
          backgroundColor: colors,
          borderColor: themeAccentRgba(0.28),
          borderWidth: 1,
        },
      ],
    };
  }, [bands, chartMetric]);

  const makeChartOptions = (
    sourceBands: AgeingBand[],
    metric: ChartMetric,
    scope: ListingScope
  ): ChartOptions<'bar'> => ({
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_evt, elements) => {
      if (!elements?.length) return;
      const idx = elements[0]?.index;
      if (typeof idx !== 'number' || idx < 0 || idx >= sourceBands.length) return;
      const key = sourceBands[idx]?.key;
      if (!key) return;
      if (selectedBand === key && drilldownScope === scope) {
        setSelectedBand(null);
      } else {
        setDrilldownScope(scope);
        setSelectedBand(key);
      }
    },
    onHover: (evt, elements) => {
      const t = evt.native?.target;
      if (t instanceof HTMLElement) {
        t.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const idx = items[0]?.dataIndex;
            if (idx == null || !sourceBands[idx]) return [];
            const b = sourceBands[idx];
            return [
              `Items: ${b.itemCount} (${formatPct(b.pctOfItems)})`,
              `Capital: ${formatGbp(b.purchaseTotal)} (${formatPct(b.pctOfCapital)})`,
              `Avg buy: ${formatGbp(b.avgPurchaseCost)}`,
              `Avg ask: ${formatGbp(b.avgAskingPrice)}`,
              WARNING_LABEL[b.warning],
              'Click bar to list items',
            ];
          },
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (typeof v !== 'number') return '';
            return metric === 'items' ? `${v} items` : formatGbp(v);
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: themeTextRgba(0.72), maxRotation: 0, minRotation: 0 },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: themeTextRgba(0.65),
          callback: (value) => {
            if (metric === 'capital' && typeof value === 'number') {
              return formatGbp(value);
            }
            return value;
          },
        },
        grid: { color: themeTextRgba(0.08) },
      },
    },
  });

  const chartOptions = useMemo(
    () => makeChartOptions(bands, chartMetric, 'live'),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate when selection/bands/metric change
    [bands, chartMetric, selectedBand, drilldownScope]
  );

  const storageChartData = useMemo(() => {
    const labels = storageBands.map((b) => b.label);
    const values =
      storageChartMetric === 'items'
        ? storageBands.map((b) => b.itemCount)
        : storageBands.map((b) => Math.round(b.purchaseTotal * 100) / 100);
    const colors = storageBands.map((b) => {
      switch (b.warning) {
        case 'healthy':
          return 'rgba(56, 189, 248, 0.78)';
        case 'watch':
          return 'rgba(14, 165, 233, 0.82)';
        case 'slow':
          return 'rgba(2, 132, 199, 0.82)';
        case 'stale':
          return 'rgba(3, 105, 161, 0.88)';
        default:
          return themeAccentRgba(0.45);
      }
    });
    return {
      labels,
      datasets: [
        {
          label: storageChartMetric === 'items' ? 'Storage items' : 'Storage capital (£)',
          data: values,
          backgroundColor: colors,
          borderColor: themeAccentRgba(0.28),
          borderWidth: 1,
        },
      ],
    };
  }, [storageBands, storageChartMetric]);

  const storageChartOptions = useMemo(
    () => makeChartOptions(storageBands, storageChartMetric, 'storage'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageBands, storageChartMetric, selectedBand, drilldownScope]
  );

  const onSelectBand = useCallback((key: string, scope: ListingScope = 'live') => {
    if (selectedBand === key && drilldownScope === scope) {
      setSelectedBand(null);
    } else {
      setDrilldownScope(scope);
      setSelectedBand(key);
    }
  }, [selectedBand, drilldownScope]);

  const liveCapitalShare =
    totals && storageTotals && totals.purchaseTotal + storageTotals.purchaseTotal > 0
      ? (totals.purchaseTotal / (totals.purchaseTotal + storageTotals.purchaseTotal)) * 100
      : null;
  const storageCapitalShare =
    totals && storageTotals && totals.purchaseTotal + storageTotals.purchaseTotal > 0
      ? (storageTotals.purchaseTotal / (totals.purchaseTotal + storageTotals.purchaseTotal)) * 100
      : null;

  const renderBandTable = (sourceBands: AgeingBand[], scope: ListingScope) => (
    <div className="inventory-ageing-table-wrap">
      <table className="inventory-ageing-table">
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col" className="inventory-ageing-num">
              Items
            </th>
            <th scope="col" className="inventory-ageing-num">
              % stock
            </th>
            <th scope="col" className="inventory-ageing-num">
              Capital
            </th>
            <th scope="col" className="inventory-ageing-num">
              % capital
            </th>
            <th scope="col" className="inventory-ageing-num">
              Avg buy
            </th>
            <th scope="col" className="inventory-ageing-num">
              Avg ask
            </th>
            <th scope="col">Flag</th>
          </tr>
        </thead>
        <tbody>
          {sourceBands.map((b) => {
            const isSelected = selectedBand === b.key && drilldownScope === scope;
            return (
              <tr
                key={`${scope}-${b.key}`}
                className={`inventory-ageing-row inventory-ageing-row--${b.warning}${
                  isSelected ? ' is-selected' : ''
                }`}
                onClick={() => onSelectBand(b.key, scope)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectBand(b.key, scope);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
                aria-label={`${b.label}: ${b.itemCount} items. Activate to list stock.`}
              >
                <td>{b.label}</td>
                <td className="inventory-ageing-num">{b.itemCount}</td>
                <td className="inventory-ageing-num">{formatPct(b.pctOfItems)}</td>
                <td className="inventory-ageing-num">{formatGbp(b.purchaseTotal)}</td>
                <td className="inventory-ageing-num">{formatPct(b.pctOfCapital)}</td>
                <td className="inventory-ageing-num">{formatGbp(b.avgPurchaseCost)}</td>
                <td className="inventory-ageing-num">{formatGbp(b.avgAskingPrice)}</td>
                <td>
                  <span className={`inventory-ageing-flag inventory-ageing-flag--${b.warning}`}>
                    {b.warning}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderBandItemsDrilldown = (scope: ListingScope) => {
    if (!showDrilldown || !selectedBandMeta || drilldownScope !== scope) return null;
    return (
      <section
        className="inventory-ageing-drilldown"
        aria-label={`Items in ${selectedBandMeta.label}`}
        id={`inventory-ageing-drilldown-${scope}`}
      >
        <div className="inventory-ageing-drilldown-header">
          <h3 className="inventory-ageing-drilldown-title">
            {selectedBandMeta.label}
            <span className="inventory-ageing-drilldown-meta">
              {' '}
              · {selectedBandMeta.itemCount} items
              {selectedBandMeta.key === 'missing-date'
                ? ' · add a purchase date to include in age bands'
                : ` · ${formatGbp(selectedBandMeta.purchaseTotal)} · ${
                    WARNING_LABEL[selectedBandMeta.warning]
                  }`}
            </span>
          </h3>
          <button
            type="button"
            className="inventory-ageing-drilldown-close"
            onClick={() => setSelectedBand(null)}
          >
            Close
          </button>
        </div>
        {bandItemsLoading ? <p className="inventory-ageing-muted">Loading items…</p> : null}
        {bandItemsError ? (
          <p className="inventory-ageing-error" role="alert">
            {bandItemsError}
          </p>
        ) : null}
        {!bandItemsLoading && !bandItemsError ? (
          bandItems.length === 0 ? (
            <p className="inventory-ageing-muted">No items in this band for the current filters.</p>
          ) : (
            <div className="inventory-ageing-items-wrap">
              <table className="inventory-ageing-items-table">
                <thead>
                  <tr>
                    <th scope="col" className="inventory-ageing-col-edit">
                      <span className="visually-hidden">Edit</span>
                    </th>
                    <th scope="col">Item</th>
                    <th scope="col">Brand</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="inventory-ageing-num">
                      Age
                    </th>
                    <th scope="col" className="inventory-ageing-num">
                      Buy
                    </th>
                    <th scope="col" className="inventory-ageing-num">
                      Ask
                    </th>
                    <th scope="col">Bought</th>
                  </tr>
                </thead>
                <tbody>
                  {bandItems.map((row) => (
                    <tr key={row.id}>
                      <td className="inventory-ageing-col-edit">
                        <Link
                          to={`/stock?editId=${encodeURIComponent(String(row.id))}`}
                          className="inventory-ageing-edit-btn"
                          title={`Edit ${row.itemName} in Stock`}
                          aria-label={`Edit ${row.itemName} in Stock`}
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
                            aria-hidden="true"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </Link>
                      </td>
                      <td>{row.itemName}</td>
                      <td>{row.brandName}</td>
                      <td>{row.categoryName}</td>
                      <td className="inventory-ageing-num">
                        {row.daysInStock != null ? formatDays(row.daysInStock) : '—'}
                      </td>
                      <td className="inventory-ageing-num">{formatGbp(row.purchasePrice)}</td>
                      <td className="inventory-ageing-num">
                        {formatGbp(row.projectedSalePrice)}
                      </td>
                      <td>{row.purchaseDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedBandMeta.itemCount > bandItems.length ? (
                <p className="inventory-ageing-muted inventory-ageing-items-note">
                  Showing {bandItems.length} of {selectedBandMeta.itemCount} items.
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </section>
    );
  };

  return (
    <div className="inventory-ageing" id="research-panel-inventory-ageing" role="tabpanel">
      <div className="inventory-ageing-filters" role="group" aria-label="Ageing filters">
        <label className="inventory-ageing-filter">
          <span className="visually-hidden">Department</span>
          <select
            value={departmentId === '' ? '' : String(departmentId)}
            onChange={(e) => {
              const v = e.target.value;
              setDepartmentId(v === '' ? '' : Number(v));
            }}
            aria-label="Department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-ageing-filter">
          <span className="visually-hidden">Stock category</span>
          <select
            value={categoryId === '' ? '' : String(categoryId)}
            onChange={(e) => {
              const v = e.target.value;
              setCategoryId(v === '' ? '' : Number(v));
            }}
            aria-label="Stock category"
          >
            <option value="">All types</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-ageing-filter">
          <span className="visually-hidden">Brand</span>
          <select
            value={brandId === '' ? '' : String(brandId)}
            onChange={(e) => {
              const v = e.target.value;
              setBrandId(v === '' ? '' : Number(v));
            }}
            aria-label="Brand"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-ageing-filter">
          <span className="visually-hidden">Live platform</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformFilter)}
            aria-label="Live platform"
          >
            <option value="all">All live platforms</option>
            <option value="vinted">Vinted listed</option>
            <option value="ebay">eBay listed</option>
            <option value="depop">Depop listed</option>
          </select>
        </label>
      </div>

      {loading ? <p className="inventory-ageing-muted">Loading ageing…</p> : null}
      {error ? (
        <p className="inventory-ageing-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && totals && storageTotals ? (
        <>
          <dl className="inventory-ageing-split" aria-label="Live vs storage capital">
            <div className="inventory-ageing-split-item">
              <dt>Live capital</dt>
              <dd>{formatGbp(totals.purchaseTotal)}</dd>
              <dd className="inventory-ageing-split-sub">
                {totals.itemCount} items
                {liveCapitalShare != null ? ` · ${formatPct(liveCapitalShare)} of capital` : ''}
              </dd>
            </div>
            <div className="inventory-ageing-split-item inventory-ageing-split-item--storage">
              <dt>Storage capital</dt>
              <dd>{formatGbp(storageTotals.purchaseTotal)}</dd>
              <dd className="inventory-ageing-split-sub">
                {storageTotals.itemCount} items
                {storageCapitalShare != null
                  ? ` · ${formatPct(storageCapitalShare)} of capital`
                  : ''}
              </dd>
            </div>
          </dl>

          <section className="inventory-ageing-section" aria-labelledby="inventory-ageing-live-heading">
            <h2 id="inventory-ageing-live-heading" className="inventory-ageing-section-title">
              Live listed
            </h2>

            <dl className="inventory-ageing-summary" aria-label="Live inventory ageing summary">
              <div className="inventory-ageing-summary-item">
                <dt>Live items</dt>
                <dd>{totals.itemCount}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Capital tied up</dt>
                <dd>{formatGbp(totals.purchaseTotal)}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Average age</dt>
                <dd>{formatDays(totals.avgAgeDays)}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Median age</dt>
                <dd>{formatDays(totals.medianAgeDays)}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Oldest live</dt>
                <dd>{formatDays(totals.oldestAgeDays)}</dd>
              </div>
            </dl>

            <div
              className="inventory-ageing-metric-toggle"
              role="group"
              aria-label="Live chart metric"
            >
              <button
                type="button"
                className={`inventory-ageing-metric-btn${chartMetric === 'items' ? ' is-active' : ''}`}
                aria-pressed={chartMetric === 'items'}
                onClick={() => setChartMetric('items')}
              >
                Items
              </button>
              <button
                type="button"
                className={`inventory-ageing-metric-btn${
                  chartMetric === 'capital' ? ' is-active' : ''
                }`}
                aria-pressed={chartMetric === 'capital'}
                onClick={() => setChartMetric('capital')}
              >
                Capital (£)
              </button>
            </div>

            <div className="inventory-ageing-chart-wrap">
              {totals.itemCount === 0 ? (
                <p className="inventory-ageing-muted">No live listed stock matches these filters.</p>
              ) : (
                <Bar data={chartData} options={chartOptions} />
              )}
            </div>

            {totals.missingPurchaseDateCount > 0 ? (
              <button
                type="button"
                className={`inventory-ageing-missing-link${
                  selectedBand === 'missing-date' && drilldownScope === 'live' ? ' is-active' : ''
                }`}
                onClick={() => {
                  if (selectedBand === 'missing-date' && drilldownScope === 'live') {
                    setSelectedBand(null);
                  } else {
                    setDrilldownScope('live');
                    setSelectedBand('missing-date');
                  }
                }}
                aria-pressed={selectedBand === 'missing-date' && drilldownScope === 'live'}
              >
                {totals.missingPurchaseDateCount} live item
                {totals.missingPurchaseDateCount === 1 ? '' : 's'} missing a purchase date — excluded
                from age bands.
              </button>
            ) : null}

            {renderBandTable(bands, 'live')}
            {renderBandItemsDrilldown('live')}
          </section>

          <section
            className="inventory-ageing-section inventory-ageing-section--storage"
            aria-labelledby="inventory-ageing-storage-heading"
          >
            <h2 id="inventory-ageing-storage-heading" className="inventory-ageing-section-title">
              Not listed
            </h2>
            <dl className="inventory-ageing-summary inventory-ageing-summary--storage" aria-label="Not listed inventory summary">
              <div className="inventory-ageing-summary-item">
                <dt>Storage items</dt>
                <dd>{storageTotals.itemCount}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Capital in storage</dt>
                <dd>{formatGbp(storageTotals.purchaseTotal)}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>eBay drafts</dt>
                <dd>{storageTotals.ebayDraftCount}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Fully unlisted</dt>
                <dd>{storageTotals.fullyUnlistedCount}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Ask value ready</dt>
                <dd>{formatGbp(storageTotals.askingTotal)}</dd>
              </div>
              <div className="inventory-ageing-summary-item">
                <dt>Avg age stored</dt>
                <dd>{formatDays(storageTotals.avgAgeDays)}</dd>
              </div>
            </dl>

            <div
              className="inventory-ageing-metric-toggle"
              role="group"
              aria-label="Storage chart metric"
            >
              <button
                type="button"
                className={`inventory-ageing-metric-btn${
                  storageChartMetric === 'items' ? ' is-active' : ''
                }`}
                aria-pressed={storageChartMetric === 'items'}
                onClick={() => setStorageChartMetric('items')}
              >
                Items
              </button>
              <button
                type="button"
                className={`inventory-ageing-metric-btn${
                  storageChartMetric === 'capital' ? ' is-active' : ''
                }`}
                aria-pressed={storageChartMetric === 'capital'}
                onClick={() => setStorageChartMetric('capital')}
              >
                Capital (£)
              </button>
            </div>

            <div className="inventory-ageing-chart-wrap">
              {storageTotals.itemCount === 0 ? (
                <p className="inventory-ageing-muted">No storage / unlisted stock matches these filters.</p>
              ) : (
                <Bar data={storageChartData} options={storageChartOptions} />
              )}
            </div>

            {renderBandTable(storageBands, 'storage')}
            {renderBandItemsDrilldown('storage')}
          </section>

        </>
      ) : null}

      {askAiHint ? (
        <p
          className={`inventory-ageing-ask-ai-hint${
            askAiHint.startsWith('Copied') ? '' : ' inventory-ageing-ask-ai-hint--error'
          }`}
          role="status"
        >
          {askAiHint}
        </p>
      ) : null}
      <div className="inventory-ageing-ask-ai-wrap">
        <button
          type="button"
          className="inventory-ageing-ask-ai-btn"
          disabled={
            askAiBusy ||
            loading ||
            !totals ||
            (totals.itemCount === 0 && (!storageTotals || storageTotals.itemCount === 0))
          }
          onClick={() => void runAskAi()}
          aria-label="Ask AI for advice on inventory ageing"
        >
          {askAiBusy ? '…' : 'Ask AI For Advice'}
        </button>
      </div>
    </div>
  );
};

export default InventoryAgeing;
