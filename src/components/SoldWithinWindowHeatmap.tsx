import React, { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './SoldWithinWindowHeatmap.css';

const API_BASE = getApiBase();
const TRANSITION_MS = 200;

type PeriodKey = 'all' | '0-3' | '3-6' | '6-9' | '9-12';

const PERIODS: { key: PeriodKey; label: string; minDays: number | null; maxDays: number | null }[] = [
  { key: 'all', label: 'All Time', minDays: null, maxDays: null },
  { key: '0-3', label: 'Last 3 Months', minDays: null, maxDays: 90 },
  { key: '3-6', label: '3-6 Months', minDays: 90, maxDays: 180 },
  { key: '6-9', label: '6-9 Months', minDays: 180, maxDays: 270 },
  { key: '9-12', label: '9-12 Months', minDays: 270, maxDays: 365 },
];

/**
 * 'sales': color by sold count (more = greener).
 * 'gap': color by (total ever bought - sold in period); fewer unsold-in-window = greener.
 * 'profit': rows ordered by total profit (highest first), colored by profit (more = greener).
 */
type ColorMode = 'sales' | 'gap' | 'profit';

type SoldWithinWindowCategory = {
  categoryId: number | null;
  departmentId: number | null;
  categoryName: string;
  departmentName: string | null;
  soldCount: number;
  saleTotal: number;
  profitTotal: number;
  totalBoughtCount: number;
  totalBoughtValue: number;
};

type SoldWithinWindowBrand = {
  brandId: number | null;
  brandName: string;
  soldCount: number;
  saleTotal: number;
  profitTotal: number;
  totalBoughtCount: number;
  totalBoughtValue: number;
};

function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(
    value
  );
}

/** Amber (ratio 0) to green (ratio 1), scaled across the current result set only. */
function heatColorForRatio(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const hue = 38 + clamped * (142 - 38);
  const saturation = 70;
  const lightness = 46 - clamped * 6;
  return `hsl(${hue.toFixed(0)}, ${saturation}%, ${lightness}%)`;
}

function heatRange(values: number[]): { min: number; max: number } {
  const max = values.reduce((acc, n) => Math.max(acc, n), 0);
  const min = values.reduce((acc, n) => Math.min(acc, n), max);
  return { min, max };
}

type Metricable = {
  soldCount: number;
  totalBoughtCount: number;
  totalBoughtValue: number;
  saleTotal: number;
  profitTotal: number;
};

/** The bought-minus-sold value gap, shown/sorted as "Profit" on the Bought vs Sold tab — lower (more negative) is better. */
function boughtVsSoldGap<T extends Metricable>(row: T): number {
  return row.totalBoughtValue - row.saleTotal;
}

/** For 'sales'/'profit', higher value is greener. For 'gap', lower value is greener. */
function metricValue<T extends Metricable>(row: T, mode: ColorMode): number {
  if (mode === 'gap') return boughtVsSoldGap(row);
  if (mode === 'profit') return row.profitTotal;
  return row.soldCount;
}

function ratioForValue(value: number, range: { min: number; max: number }, mode: ColorMode): number {
  const span = range.max - range.min;
  const raw = span > 0 ? (value - range.min) / span : 1;
  return mode === 'gap' ? 1 - raw : raw;
}

function sortRowsForMode<T extends Metricable>(rows: T[], mode: ColorMode): T[] {
  if (mode === 'profit') return [...rows].sort((a, b) => b.profitTotal - a.profitTotal);
  if (mode === 'gap') return [...rows].sort((a, b) => boughtVsSoldGap(a) - boughtVsSoldGap(b));
  return rows;
}

function periodQuery(period: PeriodKey): string {
  const def = PERIODS.find((p) => p.key === period) ?? PERIODS[0];
  const params = new URLSearchParams();
  if (def.minDays != null) params.set('minDays', String(def.minDays));
  if (def.maxDays != null) params.set('maxDays', String(def.maxDays));
  return params.toString();
}

const SoldWithinWindowHeatmap: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [mode, setMode] = useState<ColorMode>('sales');
  const [categories, setCategories] = useState<SoldWithinWindowCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<SoldWithinWindowCategory | null>(null);
  const [brands, setBrands] = useState<SoldWithinWindowBrand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [brandsError, setBrandsError] = useState<string | null>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/stock/sold-within-window?${periodQuery(period)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { categories?: SoldWithinWindowCategory[] };
        if (!cancelled) setCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const loadBrandsForCategory = (category: SoldWithinWindowCategory, forPeriod: PeriodKey) => {
    if (category.categoryId == null) return;
    setBrandsLoading(true);
    setBrandsError(null);
    fetch(
      `${API_BASE}/api/stock/sold-within-window/brands?categoryId=${category.categoryId}&${periodQuery(forPeriod)}`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ brands?: SoldWithinWindowBrand[] }>;
      })
      .then((data) => {
        setBrands(Array.isArray(data.brands) ? data.brands : []);
      })
      .catch((err) => {
        setBrandsError(err instanceof Error ? err.message : 'Failed to load data');
      })
      .finally(() => {
        setBrandsLoading(false);
      });
  };

  // Keep the drill-down in sync when the period changes while viewing a category's brands.
  useEffect(() => {
    if (selectedCategory) {
      loadBrandsForCategory(selectedCategory, period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const handleSelectCategory = (category: SoldWithinWindowCategory) => {
    setFading(true);
    window.setTimeout(() => {
      setSelectedCategory(category);
      setFading(false);
      loadBrandsForCategory(category, period);
    }, TRANSITION_MS);
  };

  const handleBack = () => {
    setFading(true);
    window.setTimeout(() => {
      setSelectedCategory(null);
      setBrands([]);
      setBrandsError(null);
      setFading(false);
    }, TRANSITION_MS);
  };

  const sortedCategories = useMemo(() => sortRowsForMode(categories, mode), [categories, mode]);
  const sortedBrands = useMemo(() => sortRowsForMode(brands, mode), [brands, mode]);

  const categoryRange = useMemo(
    () => heatRange(categories.map((row) => metricValue(row, mode))),
    [categories, mode]
  );
  const brandRange = useMemo(() => heatRange(brands.map((row) => metricValue(row, mode))), [brands, mode]);

  const gridClassName = `sold-window-heatmap__grid${fading ? ' sold-window-heatmap__grid--fading' : ''}`;

  return (
    <div className="sold-window-heatmap">
      <div className="sold-window-heatmap__controls">
        <nav className="sold-window-heatmap__periods" role="tablist" aria-label="Time period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              className={`sold-window-heatmap__period-btn${period === p.key ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <span className="sold-window-heatmap__divider" aria-hidden="true" />

        <div
          className="sold-window-heatmap__mode-toggle"
          role="group"
          aria-label="Heatmap colour basis"
        >
          <button
            type="button"
            className={`sold-window-heatmap__mode-btn${mode === 'sales' ? ' is-active' : ''}`}
            aria-pressed={mode === 'sales'}
            onClick={() => setMode('sales')}
          >
            Sales
          </button>
          <button
            type="button"
            className={`sold-window-heatmap__mode-btn${mode === 'gap' ? ' is-active' : ''}`}
            aria-pressed={mode === 'gap'}
            onClick={() => setMode('gap')}
          >
            Bought vs Sold
          </button>
          <button
            type="button"
            className={`sold-window-heatmap__mode-btn${mode === 'profit' ? ' is-active' : ''}`}
            aria-pressed={mode === 'profit'}
            onClick={() => setMode('profit')}
          >
            Profit
          </button>
        </div>
      </div>

      {!selectedCategory ? (
        <>
          {error && (
            <div className="menswear-categories-error" role="alert">
              {error}
            </div>
          )}
          {loading && <div className="menswear-categories-muted">Loading…</div>}

          {!loading && !error && categories.length === 0 && (
            <p className="menswear-categories-muted">No categories have sold in this period yet.</p>
          )}

          {!loading && !error && categories.length > 0 && (
            <div key="categories" className={gridClassName}>
              {sortedCategories.map((row) => {
                const value = metricValue(row, mode);
                const ratio = ratioForValue(value, categoryRange, mode);
                const color = heatColorForRatio(ratio);
                const key = `${row.categoryId ?? 'none'}-${row.departmentId ?? 'none'}-${row.categoryName}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className="sold-window-heatmap__tile"
                    style={{ background: color }}
                    onClick={() => handleSelectCategory(row)}
                  >
                    <span className="sold-window-heatmap__tile-name">{row.categoryName}</span>
                    {row.departmentName && (
                      <span className="sold-window-heatmap__tile-dept">{row.departmentName}</span>
                    )}
                    {mode === 'gap' && (
                      <span className="sold-window-heatmap__tile-count">
                        {formatGbp(boughtVsSoldGap(row))} Profit
                      </span>
                    )}
                    {mode === 'profit' && (
                      <span className="sold-window-heatmap__tile-count">{formatGbp(row.profitTotal)} profit</span>
                    )}
                    {mode === 'sales' && <span className="sold-window-heatmap__tile-count">{row.soldCount} sold</span>}
                    {mode === 'sales' && (
                      <span className="sold-window-heatmap__tile-value">Sold value: {formatGbp(row.saleTotal)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="sold-window-heatmap__header sold-window-heatmap__header--drilldown">
            <button type="button" className="sold-window-heatmap__back" onClick={handleBack}>
              ← Back to categories
            </button>
          </div>

          {brandsError && (
            <div className="menswear-categories-error" role="alert">
              {brandsError}
            </div>
          )}
          {brandsLoading && <div className="menswear-categories-muted">Loading…</div>}

          {!brandsLoading && !brandsError && brands.length === 0 && (
            <p className="menswear-categories-muted">No brands in this category have sold in this period yet.</p>
          )}

          {!brandsLoading && !brandsError && brands.length > 0 && (
            <div key="brands" className={gridClassName}>
              {sortedBrands.map((row) => {
                const value = metricValue(row, mode);
                const ratio = ratioForValue(value, brandRange, mode);
                const color = heatColorForRatio(ratio);
                const key = `${row.brandId ?? 'none'}-${row.brandName}`;
                return (
                  <div key={key} className="sold-window-heatmap__tile" style={{ background: color }}>
                    <span className="sold-window-heatmap__tile-name">{row.brandName}</span>
                    {mode === 'gap' && (
                      <span className="sold-window-heatmap__tile-count">
                        {formatGbp(boughtVsSoldGap(row))} Profit
                      </span>
                    )}
                    {mode === 'profit' && (
                      <span className="sold-window-heatmap__tile-count">{formatGbp(row.profitTotal)} profit</span>
                    )}
                    {mode === 'sales' && <span className="sold-window-heatmap__tile-count">{row.soldCount} sold</span>}
                    {mode === 'sales' && (
                      <span className="sold-window-heatmap__tile-value">Sold value: {formatGbp(row.saleTotal)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SoldWithinWindowHeatmap;
