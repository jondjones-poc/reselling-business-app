import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { apiFetch, apiUrl } from '../utils/apiBase';
import './Stock.css';
import './ResearchInFashion.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

type TrendsMode = 'brands' | 'discover';
type BrandTrendWindow = '6m' | '1y' | '2y' | '5y';

type CategoryOption = {
  key: string;
  label: string;
  seedCount?: number;
};

type DepartmentOption = {
  key: string;
  label: string;
  seedCount: number;
  ebayCategoryId: string | null;
  categories?: CategoryOption[];
};

type BrandTrendRow = {
  brandId: number;
  brandName: string;
  departmentId: number | null;
  window: BrandTrendWindow;
  score: number | null;
  direction: 'rising' | 'flat' | 'fading' | string;
  sparkline: Array<{ label: string; value: number }>;
  trendsError: string | null;
  fetchedAt: string | null;
};

/** Google Trends serves a CAPTCHA/HTML page when it rate-limits, which surfaces as a JSON parse error. */
const TRENDS_BLOCK_MESSAGE = /unexpected token\s*'?<|not valid json|<!doctype|<html/i;

function isTrendsBlockMessage(raw: string | null | undefined): boolean {
  return TRENDS_BLOCK_MESSAGE.test(String(raw || ''));
}

function friendlyTrendsMessage(raw: string | null | undefined): string | null {
  const message = String(raw || '').trim();
  if (!message) return null;
  if (isTrendsBlockMessage(message)) {
    return 'Google Trends is rate-limiting requests right now. Saved scores are unchanged — try again later.';
  }
  return message;
}

function slugifyCategoryKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deptNameToTrendKey(name: string): string | null {
  const key = slugifyCategoryKey(name);
  if (!key) return null;
  const aliases: Record<string, string> = {
    menswear: 'menswear',
    mens: 'menswear',
    men: 'menswear',
    womenswear: 'womenswear',
    womens: 'womenswear',
    women: 'womenswear',
    electronics: 'electronics',
    media: 'media',
    toys: 'toys',
    'bric-a-brac': 'bric-a-brac',
    bricabrac: 'bric-a-brac',
  };
  return aliases[key] || null;
}

/** Prefer exact department name (e.g. Menswear) over aliases like Men / Mens. */
function findDepartmentRow(
  rows: Array<{ id: number; department_name: string }>,
  trendKey: string
): { id: number; department_name: string } | null {
  const exact = rows.find(
    (d) => slugifyCategoryKey(d.department_name) === trendKey || d.department_name.trim().toLowerCase() === trendKey
  );
  if (exact) return exact;
  return rows.find((d) => deptNameToTrendKey(d.department_name) === trendKey) ?? null;
}

type RisingIdea = {
  query: string;
  value: string;
  seed: string;
  isRising: boolean;
};

type InterestPoint = { label: string; value: number };

type RelatedTopic = { title: string; type: string; value: string };

type TrendQuery = { query: string; value: string };

type EbaySoldThumb = {
  itemId: string | null;
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  itemWebUrl: string | null;
  condition: string | null;
};

type QueryDetail = {
  query: string;
  interestOverTime: InterestPoint[];
  interestError: string | null;
  relatedQueries: TrendQuery[];
  risingQueries: TrendQuery[];
  relatedError: string | null;
  topTopics: RelatedTopic[];
  risingTopics: RelatedTopic[];
  topicsError: string | null;
  ebaySold: EbaySoldThumb[];
  ebayError: string | null;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function formatGbp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

const ResearchInFashion: React.FC = () => {
  const [trendsMode, setTrendsMode] = useState<TrendsMode>('brands');
  const [brandWindow, setBrandWindow] = useState<BrandTrendWindow>('1y');
  const [brandRows, setBrandRows] = useState<BrandTrendRow[]>([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandRefreshBusy, setBrandRefreshBusy] = useState(false);
  const [brandRefreshNote, setBrandRefreshNote] = useState<string | null>(null);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [department, setDepartment] = useState('menswear');
  const [category, setCategory] = useState('all');
  const [dbCategories, setDbCategories] = useState<CategoryOption[]>([{ key: 'all', label: 'All' }]);
  const [rising, setRising] = useState<RisingIdea[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);

  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  const [detail, setDetail] = useState<QueryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const categories = useMemo(() => {
    return dbCategories.length > 0 ? dbCategories : [{ key: 'all', label: 'All' }];
  }, [dbCategories]);

  const selectedCategoryLabel = useMemo(() => {
    if (category === 'all') return 'All';
    return categories.find((c) => c.key === category)?.label || category;
  }, [categories, category]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/research/in-fashion/departments'));
        const data = await readJson<{ departments?: DepartmentOption[] }>(res);
        const rows = Array.isArray(data.departments) ? data.departments : [];
        setDepartments(rows);
        if (rows.length > 0 && !rows.some((d) => d.key === department)) {
          setDepartment(rows[0].key);
        }
      } catch {
        setDepartments([
          {
            key: 'menswear',
            label: 'Menswear',
            seedCount: 0,
            ebayCategoryId: '11450',
          },
          {
            key: 'electronics',
            label: 'Electronics',
            seedCount: 0,
            ebayCategoryId: '293',
          },
        ]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const deptRes = await fetch(apiUrl('/api/departments'));
        const deptData = await readJson<{
          rows?: Array<{ id: number; department_name: string }>;
        }>(deptRes);
        const deptRows = Array.isArray(deptData.rows) ? deptData.rows : [];
        const match = findDepartmentRow(deptRows, department);
        const departmentId = match?.id ?? null;

        const toOptions = (labels: string[]): CategoryOption[] => {
          const opts: CategoryOption[] = [{ key: 'all', label: 'All' }];
          const seen = new Set<string>(['all']);
          for (const labelRaw of labels) {
            const label = String(labelRaw || '').trim();
            if (!label) continue;
            const key = slugifyCategoryKey(label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            opts.push({ key, label });
          }
          return opts;
        };

        let next: CategoryOption[] = [{ key: 'all', label: 'All' }];

        // Same stock categories as Research clothing types / Config (shirts, trousers, …).
        if (departmentId != null) {
          const res = await fetch(
            apiUrl(`/api/categories?department_id=${encodeURIComponent(String(departmentId))}`)
          );
          const data = await readJson<{
            rows?: Array<{ id: number; category_name: string }>;
          }>(res);
          if (!res.ok) {
            throw new Error('Failed to load categories');
          }
          next = toOptions(
            (Array.isArray(data.rows) ? data.rows : []).map((r) => String(r.category_name || ''))
          );
        }

        if (!cancelled) {
          setDbCategories(next);
          setCategory((prev) => (next.some((c) => c.key === prev) ? prev : 'all'));
        }
      } catch {
        if (!cancelled) {
          setDbCategories([{ key: 'all', label: 'All' }]);
          setCategory('all');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [department]);

  useEffect(() => {
    if (!categories.some((c) => c.key === category)) {
      setCategory('all');
    }
  }, [categories, category]);

  const loadDiscover = useCallback(
    async (options?: { refresh?: boolean }) => {
      setDiscoverLoading(true);
      setDiscoverError(null);
      setSelectedQuery(null);
      setDetail(null);
      try {
        const params = new URLSearchParams({ department, category });
        if (category !== 'all') {
          params.set('category_label', selectedCategoryLabel);
        }
        if (options?.refresh) params.set('refresh', '1');
        const res = await fetch(apiUrl(`/api/research/in-fashion/discover?${params}`));
        const data = await readJson<{
          rising?: RisingIdea[];
          warnings?: string[];
          error?: string;
          details?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.details || data.error || res.statusText);
        }
        setRising(Array.isArray(data.rising) ? data.rising : []);
        const nextWarnings = Array.isArray(data.warnings) ? data.warnings : [];
        setWarnings(nextWarnings);
        setShowWarnings(nextWarnings.length > 0);
      } catch (e) {
        setRising([]);
        setDiscoverError(e instanceof Error ? e.message : 'Could not load trends');
      } finally {
        setDiscoverLoading(false);
      }
    },
    [department, category, selectedCategoryLabel]
  );

  useEffect(() => {
    if (trendsMode !== 'discover') return;
    void loadDiscover();
  }, [loadDiscover, trendsMode]);

  const loadBrandTrends = useCallback(async () => {
    setBrandLoading(true);
    setBrandError(null);
    try {
      const params = new URLSearchParams({
        department,
        window: brandWindow,
      });
      const res = await apiFetch(`/api/research/in-fashion/brand-trends?${params}`);
      const data = await readJson<{
        rows?: BrandTrendRow[];
        error?: string;
        details?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.details || data.error || res.statusText);
      }
      setBrandRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setBrandRows([]);
      setBrandError(
        friendlyTrendsMessage(e instanceof Error ? e.message : null) ||
          'Could not load brand trends'
      );
    } finally {
      setBrandLoading(false);
    }
  }, [department, brandWindow]);

  useEffect(() => {
    if (trendsMode !== 'brands') return;
    void loadBrandTrends();
  }, [loadBrandTrends, trendsMode]);

  const handleBrandTrendsRefresh = useCallback(async () => {
    if (brandRefreshBusy) return;
    setBrandRefreshBusy(true);
    setBrandRefreshNote(null);
    try {
      const params = new URLSearchParams({ department });
      const res = await apiFetch(`/api/research/in-fashion/brand-trends/refresh?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await readJson<{
        ok?: boolean;
        started?: boolean;
        alreadyRunning?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setBrandRefreshNote(
        data.alreadyRunning
          ? 'Refresh already running in the background…'
          : 'Weekly-style refresh started. This can take several minutes — scores update as brands finish.'
      );

      let polls = 0;
      const maxPolls = 90;
      let lastSummary: {
        ok?: number;
        failed?: number;
        total?: number;
        stoppedEarly?: boolean;
        stopReason?: string | null;
      } | null = null;
      while (polls < maxPolls) {
        await new Promise((r) => window.setTimeout(r, 4000));
        polls += 1;
        const statusRes = await apiFetch('/api/research/in-fashion/brand-trends/refresh-status');
        const status = await readJson<{
          running?: boolean;
          lastSummary?: {
            ok?: number;
            failed?: number;
            total?: number;
            stoppedEarly?: boolean;
            stopReason?: string | null;
          } | null;
        }>(statusRes);
        if (status.lastSummary) lastSummary = status.lastSummary;
        if (!status.running) break;
      }
      await loadBrandTrends();
      if (lastSummary?.stopReason) {
        setBrandRefreshNote(lastSummary.stopReason);
      } else if (lastSummary && (lastSummary.failed ?? 0) > 0 && (lastSummary.ok ?? 0) === 0) {
        setBrandRefreshNote(
          'Google Trends blocked or rate-limited every brand. Wait a bit, then try again (or leave it to the weekly cron).'
        );
      } else if (lastSummary && (lastSummary.failed ?? 0) > 0) {
        setBrandRefreshNote(
          `Refresh finished: ${lastSummary.ok ?? 0} ok, ${lastSummary.failed ?? 0} failed of ${lastSummary.total ?? 0}.`
        );
      } else {
        setBrandRefreshNote('Brand trends refresh finished.');
      }
    } catch (e) {
      setBrandRefreshNote(
        friendlyTrendsMessage(e instanceof Error ? e.message : null) || 'Refresh failed'
      );
    } finally {
      setBrandRefreshBusy(false);
    }
  }, [brandRefreshBusy, department, loadBrandTrends]);

  useEffect(() => {
    if (!brandRefreshNote) return;
    const t = window.setTimeout(() => setBrandRefreshNote(null), 5000);
    return () => window.clearTimeout(t);
  }, [brandRefreshNote]);

  useEffect(() => {
    if (!showWarnings || warnings.length === 0) return;
    const t = window.setTimeout(() => setShowWarnings(false), 5000);
    return () => window.clearTimeout(t);
  }, [showWarnings, warnings]);

  const loadDetail = useCallback(
    async (query: string) => {
      setSelectedQuery(query);
      setDetailLoading(true);
      setDetailError(null);
      setDetail(null);
      try {
        const params = new URLSearchParams({ q: query, department });
        const res = await fetch(apiUrl(`/api/research/in-fashion/query-detail?${params}`));
        const data = await readJson<QueryDetail & { error?: string; details?: string }>(res);
        if (!res.ok) {
          throw new Error(data.details || data.error || res.statusText);
        }
        setDetail({
          query: data.query || query,
          interestOverTime: Array.isArray(data.interestOverTime) ? data.interestOverTime : [],
          interestError: data.interestError ?? null,
          relatedQueries: Array.isArray(data.relatedQueries) ? data.relatedQueries : [],
          risingQueries: Array.isArray(data.risingQueries) ? data.risingQueries : [],
          relatedError: data.relatedError ?? null,
          topTopics: Array.isArray(data.topTopics) ? data.topTopics : [],
          risingTopics: Array.isArray(data.risingTopics) ? data.risingTopics : [],
          topicsError: data.topicsError ?? null,
          ebaySold: Array.isArray(data.ebaySold) ? data.ebaySold : [],
          ebayError: data.ebayError ?? null,
        });
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Could not load detail');
      } finally {
        setDetailLoading(false);
      }
    },
    [department]
  );

  const chartData = useMemo(() => {
    const points = detail?.interestOverTime ?? [];
    return {
      labels: points.map((p) => p.label),
      datasets: [
        {
          label: 'Search interest',
          data: points.map((p) => p.value),
          borderColor: 'rgba(96, 165, 250, 0.95)',
          backgroundColor: 'rgba(59, 130, 246, 0.18)',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    };
  }, [detail]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index' as const, intersect: false },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            color: 'rgba(255,255,255,0.45)',
            font: { size: 10 },
          },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: 'rgba(255,255,255,0.45)', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
    }),
    []
  );

  const modelIdeas = useMemo(() => {
    if (!detail) return [] as Array<{ label: string; value: string; kind: string }>;
    const out: Array<{ label: string; value: string; kind: string }> = [];
    for (const r of detail.risingQueries) {
      out.push({ label: r.query, value: r.value, kind: 'Rising query' });
    }
    for (const r of detail.relatedQueries) {
      if (out.some((x) => x.label.toLowerCase() === r.query.toLowerCase())) continue;
      out.push({ label: r.query, value: r.value, kind: 'Related' });
    }
    for (const t of [...detail.risingTopics, ...detail.topTopics]) {
      if (out.some((x) => x.label.toLowerCase() === t.title.toLowerCase())) continue;
      out.push({
        label: t.title,
        value: t.value,
        kind: t.type ? `Topic · ${t.type}` : 'Topic',
      });
    }
    return out.slice(0, 24);
  }, [detail]);

  const deptLabel = departments.find((d) => d.key === department)?.label || department;
  const categoryLabel = selectedCategoryLabel;

  const brandWindowOptions: Array<{ key: BrandTrendWindow; label: string }> = [
    { key: '6m', label: '6 months' },
    { key: '1y', label: '1 year' },
    { key: '2y', label: '2 years' },
    { key: '5y', label: '5 years' },
  ];

  const formatScore = (score: number | null) => {
    if (score == null || !Number.isFinite(score)) return '—';
    const rounded = Math.round(score * 10) / 10;
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  };

  const sparkOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true, max: 100 },
      },
      elements: {
        point: { radius: 0 },
        line: { borderWidth: 1.5, tension: 0.3 },
      },
    }),
    []
  );

  return (
    <div
      className={
        'research-in-fashion' +
        (trendsMode === 'brands' ? ' research-in-fashion--brands' : ' research-in-fashion--discover')
      }
    >
      <div className="research-in-fashion-filters">
        <div className="research-in-fashion-mode-toggle" role="group" aria-label="Trends view">
          <button
            type="button"
            className={
              'research-in-fashion-mode-btn' +
              (trendsMode === 'brands' ? ' research-in-fashion-mode-btn--active' : '')
            }
            aria-pressed={trendsMode === 'brands'}
            onClick={() => setTrendsMode('brands')}
          >
            Brand pulse
          </button>
          <button
            type="button"
            className={
              'research-in-fashion-mode-btn' +
              (trendsMode === 'discover' ? ' research-in-fashion-mode-btn--active' : '')
            }
            aria-pressed={trendsMode === 'discover'}
            onClick={() => setTrendsMode('discover')}
          >
            Discover
          </button>
        </div>

        <div className="research-in-fashion-dept-bar">
          <nav className="research-in-fashion-dept-pills" aria-label="Department filter">
            {(departments.length
              ? departments
              : [{ key: 'menswear', label: 'Menswear', seedCount: 0, ebayCategoryId: null }]
            ).map((d) => (
              <button
                key={d.key}
                type="button"
                className={
                  'research-in-fashion-dept-pill' +
                  (department === d.key ? ' research-in-fashion-dept-pill--active' : '')
                }
                aria-pressed={department === d.key}
                onClick={() => {
                  setDepartment(d.key);
                  setCategory('all');
                }}
              >
                {d.label}
              </button>
            ))}
          </nav>
          {trendsMode === 'discover' ? (
            <button
              type="button"
              className="stock-refresh-icon-button research-in-fashion-dept-refresh"
              onClick={() => void loadDiscover({ refresh: true })}
              disabled={discoverLoading}
              title="Refresh trends"
              aria-label="Refresh trends"
            >
              ↻
            </button>
          ) : null}
        </div>

        {trendsMode === 'brands' ? (
          <nav className="research-in-fashion-window-pills" aria-label="Trend time window">
            {brandWindowOptions.map((w) => (
              <button
                key={w.key}
                type="button"
                className={
                  'research-in-fashion-window-pill' +
                  (brandWindow === w.key ? ' research-in-fashion-window-pill--active' : '')
                }
                aria-pressed={brandWindow === w.key}
                onClick={() => setBrandWindow(w.key)}
              >
                {w.label}
              </button>
            ))}
          </nav>
        ) : null}

        {trendsMode === 'discover' && categories.length > 1 ? (
          <div className="research-in-fashion-category-bar">
            <div className="research-in-fashion-category-scroll" role="presentation">
              <nav className="research-in-fashion-category-pills" aria-label="Category filter">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={
                      'research-in-fashion-category-pill' +
                      (category === c.key ? ' research-in-fashion-category-pill--active' : '')
                    }
                    aria-pressed={category === c.key}
                    onClick={() => setCategory(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        ) : null}
      </div>

      {trendsMode === 'brands' ? (
        <>
          {brandRefreshBusy ? (
            <div
              className="research-in-fashion-brand-refresh-progress"
              role="status"
              aria-live="polite"
              aria-label="Refreshing brand trends from Google Trends"
            >
              <span className="research-in-fashion-brand-refresh-spinner" aria-hidden="true" />
              <span>Refreshing from Google Trends…</span>
            </div>
          ) : null}
          {brandError ? (
            <div className="research-in-fashion-banner research-in-fashion-banner--error" role="alert">
              {brandError}
            </div>
          ) : null}
          {brandRefreshNote ? (
            <div className="research-in-fashion-banner research-in-fashion-banner--warn" role="status">
              {brandRefreshNote}
            </div>
          ) : null}

          {brandLoading && brandRows.length === 0 ? (
            <p className="research-in-fashion-muted">Loading brand pulse for {deptLabel}…</p>
          ) : brandRows.length === 0 ? null : (
            <ul className="research-in-fashion-brand-grid" aria-label="Brand trend pulse">
              {brandRows.map((row) => {
                const dir = row.direction || 'flat';
                const spark = {
                  labels: row.sparkline.map((p) => p.label),
                  datasets: [
                    {
                      data: row.sparkline.map((p) => p.value),
                      borderColor:
                        dir === 'rising'
                          ? 'rgba(74, 222, 128, 0.95)'
                          : dir === 'fading'
                            ? 'rgba(248, 113, 113, 0.95)'
                            : 'rgba(148, 163, 184, 0.9)',
                      backgroundColor: 'transparent',
                      fill: false,
                    },
                  ],
                };
                return (
                  <li key={row.brandId}>
                    <article
                      className={
                        'research-in-fashion-brand-card research-in-fashion-brand-card--' + dir
                      }
                    >
                      <header className="research-in-fashion-brand-card-head">
                        <h3 className="research-in-fashion-brand-card-name">{row.brandName}</h3>
                        <span
                          className={
                            'research-in-fashion-brand-dir research-in-fashion-brand-dir--' + dir
                          }
                        >
                          {dir === 'rising' ? 'Trending' : dir === 'fading' ? 'Fading' : 'Flat'}
                        </span>
                      </header>
                      <p className="research-in-fashion-brand-score">{formatScore(row.score)}</p>
                      <div className="research-in-fashion-brand-spark">
                        {row.sparkline.length > 1 ? (
                          <Line data={spark} options={sparkOptions} />
                        ) : (
                          <span className="research-in-fashion-muted">No series</span>
                        )}
                      </div>
                      {row.trendsError && !isTrendsBlockMessage(row.trendsError) ? (
                        <p className="research-in-fashion-brand-err">{row.trendsError}</p>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="research-in-fashion-brand-refresh-footer">
            <button
              type="button"
              className="research-in-fashion-brand-refresh-btn"
              onClick={() => void handleBrandTrendsRefresh()}
              disabled={brandRefreshBusy}
            >
              Refresh brand trends now
            </button>
          </div>
        </>
      ) : (
        <>
          {discoverError ? (
            <div className="research-in-fashion-banner research-in-fashion-banner--error" role="alert">
              {discoverError}
            </div>
          ) : null}

          {showWarnings && warnings.length > 0 && !discoverLoading ? (
            <div className="research-in-fashion-banner research-in-fashion-banner--warn" role="status">
              Some seed lookups failed ({warnings.length}). Showing whatever Trends returned.
            </div>
          ) : null}

          <div className="research-in-fashion-discover-layout">
            <section className="research-in-fashion-rising-panel" aria-label="Rising ideas">
              <h3 className="research-in-fashion-panel-title">Research queue</h3>
              {discoverLoading && rising.length === 0 ? (
                <p className="research-in-fashion-muted">
                  Scanning Google Trends for {deptLabel}
                  {category !== 'all' ? ` · ${categoryLabel}` : ''}…
                </p>
              ) : rising.length === 0 ? (
                <p className="research-in-fashion-muted">No rising ideas yet. Try refresh.</p>
              ) : (
                <ul className="research-in-fashion-rising-list">
                  {rising.map((idea) => (
                    <li key={idea.query}>
                      <button
                        type="button"
                        className={
                          'research-in-fashion-rising-item' +
                          (selectedQuery === idea.query
                            ? ' research-in-fashion-rising-item--active'
                            : '')
                        }
                        onClick={() => void loadDetail(idea.query)}
                      >
                        <span className="research-in-fashion-rising-query">{idea.query}</span>
                        <span className="research-in-fashion-rising-meta">
                          {idea.value ? (
                            <span className="research-in-fashion-rising-value">{idea.value}</span>
                          ) : null}
                          {idea.isRising ? (
                            <span className="research-in-fashion-rising-badge">Rising</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="research-in-fashion-detail-panel" aria-label="Selected trend detail">
              {!selectedQuery && !detailLoading ? (
                <div className="research-in-fashion-detail-empty">
                  <p>
                    Select a rising search on the left to see interest over time, model-level ideas,
                    and recent eBay solds.
                  </p>
                </div>
              ) : null}

              {detailLoading ? (
                <p className="research-in-fashion-muted" aria-busy="true">
                  Loading detail for “{selectedQuery}”…
                </p>
              ) : null}

              {detailError ? (
                <div className="research-in-fashion-banner research-in-fashion-banner--error" role="alert">
                  {detailError}
                </div>
              ) : null}

              {detail && !detailLoading ? (
                <>
                  <h3 className="research-in-fashion-detail-heading">{detail.query}</h3>

                  <div className="research-in-fashion-chart-wrap">
                    <h4 className="research-in-fashion-panel-title">Interest over time (GB, ~90 days)</h4>
                    {detail.interestError ? (
                      <p className="research-in-fashion-muted">{detail.interestError}</p>
                    ) : detail.interestOverTime.length === 0 ? (
                      <p className="research-in-fashion-muted">No interest series returned.</p>
                    ) : (
                      <div className="research-in-fashion-chart">
                        <Line data={chartData} options={chartOptions} />
                      </div>
                    )}
                  </div>

                  <div className="research-in-fashion-models">
                    <h4 className="research-in-fashion-panel-title">Models & related ideas</h4>
                    {detail.relatedError || detail.topicsError ? (
                      <p className="research-in-fashion-muted">
                        {[detail.relatedError, detail.topicsError].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {modelIdeas.length === 0 ? (
                      <p className="research-in-fashion-muted">No related models yet.</p>
                    ) : (
                      <ul className="research-in-fashion-model-grid">
                        {modelIdeas.map((m) => (
                          <li key={`${m.kind}-${m.label}`}>
                            <button
                              type="button"
                              className="research-in-fashion-model-card"
                              onClick={() => void loadDetail(m.label)}
                              title={`Research ${m.label}`}
                            >
                              <span className="research-in-fashion-model-label">{m.label}</span>
                              <span className="research-in-fashion-model-kind">
                                {m.kind}
                                {m.value ? ` · ${m.value}` : ''}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="research-in-fashion-ebay">
                    <h4 className="research-in-fashion-panel-title">Recent eBay UK solds</h4>
                    {detail.ebayError ? (
                      <p className="research-in-fashion-muted">{detail.ebayError}</p>
                    ) : detail.ebaySold.length === 0 ? (
                      <p className="research-in-fashion-muted">No sold comps in this window.</p>
                    ) : (
                      <ul className="research-in-fashion-ebay-grid">
                        {detail.ebaySold.map((item, idx) => {
                          const inner = (
                            <>
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt="" loading="lazy" />
                              ) : (
                                <span className="research-in-fashion-ebay-noimg">No image</span>
                              )}
                              <span className="research-in-fashion-ebay-price">
                                {formatGbp(item.price)}
                              </span>
                              <span className="research-in-fashion-ebay-title">{item.title}</span>
                            </>
                          );
                          return (
                            <li key={item.itemId || `${item.title}-${idx}`}>
                              {item.itemWebUrl ? (
                                <a
                                  href={item.itemWebUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="research-in-fashion-ebay-card"
                                >
                                  {inner}
                                </a>
                              ) : (
                                <div className="research-in-fashion-ebay-card">{inner}</div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </section>
          </div>
        </>
      )}
    </div>
  );
};

export default ResearchInFashion;
