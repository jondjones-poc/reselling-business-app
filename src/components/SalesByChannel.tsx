import React, { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import { themeAccentRgba, themeTextRgba } from '../utils/themeColors';
import { StockFormDropdown } from './StockFormDropdown';
import './Reporting.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

const API_BASE = getApiBase();

const CHART_EBAY_YELLOW = '#F5AF02';
const CHART_EBAY_YELLOW_FILL = 'rgba(245, 175, 2, 0.65)';
const CHART_VINTED_BLUE = '#09B1BA';
const CHART_VINTED_BLUE_FILL = 'rgba(9, 177, 186, 0.65)';
const CHART_COMBINED_GREY = '#9CA3AF';
const CHART_COMBINED_GREY_FILL = 'rgba(156, 163, 175, 0.5)';

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(value ?? 0);

interface SalesByChannelCategoryRow {
  id: number;
  category_name: string;
  department_id: number | null;
}

interface SalesByChannelDepartmentRow {
  id: number;
  department_name: string;
}

interface ChannelWeeklyPoint {
  weekStart: string;
  weekEnd: string;
  label: string;
  vintedSales: number;
  ebaySales: number;
  vintedProfit: number;
  ebayProfit: number;
  vintedCount: number;
  ebayCount: number;
}

type ChannelPeriod = 'weekly' | 'monthly' | 'bi-monthly';

/** Bucket key + display label for a week's start date, under the given period. */
function periodKeyAndLabel(weekStart: string, period: 'monthly' | 'bi-monthly'): { key: string; label: string } {
  const d = new Date(`${weekStart}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  if (period === 'monthly') {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { key, label };
  }
  // Bi-monthly: calendar month pairs (Jan–Feb, Mar–Apr, …), matching this app's
  // existing "bimester" convention used elsewhere for seasonal reporting.
  const pairIndex = Math.floor(month / 2);
  const startMonth = pairIndex * 2;
  const key = `${year}-P${pairIndex}`;
  const startLabel = new Date(Date.UTC(year, startMonth, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const endLabel = new Date(Date.UTC(year, startMonth + 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return { key, label: `${startLabel}–${endLabel} ${year}` };
}

/** Re-buckets already-fetched weekly points into monthly/bi-monthly totals (summed, not averaged). */
function aggregateChannelWeeks(weeks: ChannelWeeklyPoint[], period: ChannelPeriod): ChannelWeeklyPoint[] {
  if (period === 'weekly') return weeks;
  const buckets = new Map<string, ChannelWeeklyPoint>();
  for (const w of weeks) {
    const { key, label } = periodKeyAndLabel(w.weekStart, period);
    const existing = buckets.get(key);
    if (existing) {
      existing.vintedSales += w.vintedSales;
      existing.ebaySales += w.ebaySales;
      existing.vintedProfit += w.vintedProfit;
      existing.ebayProfit += w.ebayProfit;
      existing.vintedCount += w.vintedCount;
      existing.ebayCount += w.ebayCount;
      if (w.weekEnd > existing.weekEnd) existing.weekEnd = w.weekEnd;
    } else {
      buckets.set(key, {
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        label,
        vintedSales: w.vintedSales,
        ebaySales: w.ebaySales,
        vintedProfit: w.vintedProfit,
        ebayProfit: w.ebayProfit,
        vintedCount: w.vintedCount,
        ebayCount: w.ebayCount,
      });
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}

export default function SalesByChannel() {
  const [categoryRows, setCategoryRows] = useState<SalesByChannelCategoryRow[]>([]);
  const [departmentRows, setDepartmentRows] = useState<SalesByChannelDepartmentRow[]>([]);

  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [showCombined, setShowCombined] = useState(true);
  const [period, setPeriod] = useState<ChannelPeriod>('weekly');
  /** "Total Sales By Channel" card: plot £ sales or item counts. */
  const [totalsMetric, setTotalsMetric] = useState<'sales' | 'items'>('sales');

  const [weeksAll, setWeeksAll] = useState<ChannelWeeklyPoint[]>([]);
  const [weeksAllLoading, setWeeksAllLoading] = useState(false);
  const [weeksAllError, setWeeksAllError] = useState('');

  const [departmentFilter, setDepartmentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [weeksFiltered, setWeeksFiltered] = useState<ChannelWeeklyPoint[]>([]);
  const [weeksFilteredLoading, setWeeksFilteredLoading] = useState(false);
  const [weeksFilteredError, setWeeksFilteredError] = useState('');

  const [itemsSoldDepartmentFilter, setItemsSoldDepartmentFilter] = useState('');
  const [itemsSoldCategoryFilter, setItemsSoldCategoryFilter] = useState('');
  const [itemsSoldWeeks, setItemsSoldWeeks] = useState<ChannelWeeklyPoint[]>([]);
  const [itemsSoldLoading, setItemsSoldLoading] = useState(false);
  const [itemsSoldError, setItemsSoldError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/categories`);
        if (!response.ok) return;
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (cancelled) return;
        const mapped: Array<SalesByChannelCategoryRow | null> = rows.map(
          (r: { id?: unknown; category_name?: unknown; department_id?: unknown }): SalesByChannelCategoryRow | null => {
            const id = Number(r.id);
            if (!Number.isFinite(id)) return null;
            const nm = (r.category_name != null ? String(r.category_name) : '').trim();
            const departmentId = Number(r.department_id);
            return { id, category_name: nm || 'Uncategorized', department_id: Number.isFinite(departmentId) ? departmentId : null };
          }
        );
        setCategoryRows(mapped.filter((r): r is SalesByChannelCategoryRow => r != null));
      } catch {
        if (!cancelled) setCategoryRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/departments`);
        if (!response.ok) return;
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (cancelled) return;
        const mapped: Array<SalesByChannelDepartmentRow | null> = rows.map(
          (r: { id?: unknown; department_name?: unknown }): SalesByChannelDepartmentRow | null => {
            const id = Number(r.id);
            if (!Number.isFinite(id)) return null;
            const nm = (r.department_name != null ? String(r.department_name) : '').trim();
            return { id, department_name: nm || 'Unnamed' };
          }
        );
        setDepartmentRows(mapped.filter((r): r is SalesByChannelDepartmentRow => r != null));
      } catch {
        if (!cancelled) setDepartmentRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Unfiltered weekly eBay-vs-Vinted sales/profit, last 12 months — fetched once
  // on mount since this data doesn't depend on any filter, unlike the
  // department/category chart below it.
  useEffect(() => {
    if (weeksAll.length > 0) {
      return;
    }
    let cancelled = false;
    (async () => {
      setWeeksAllLoading(true);
      setWeeksAllError('');
      try {
        const response = await fetch(`${API_BASE}/api/reporting/channel-weekly`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load channel analytics.');
        setWeeksAll(Array.isArray(data.weeks) ? data.weeks : []);
      } catch (e) {
        if (!cancelled) setWeeksAllError(e instanceof Error ? e.message : 'Could not load channel analytics.');
      } finally {
        if (!cancelled) setWeeksAllLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeksAll.length]);

  // The department/category-filterable chart — refetches whenever either filter changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWeeksFilteredLoading(true);
      setWeeksFilteredError('');
      try {
        const params = new URLSearchParams();
        if (departmentFilter) params.set('department_id', departmentFilter);
        if (categoryFilter) params.set('category_id', categoryFilter);
        const response = await fetch(`${API_BASE}/api/reporting/channel-weekly?${params.toString()}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load channel analytics.');
        setWeeksFiltered(Array.isArray(data.weeks) ? data.weeks : []);
      } catch (e) {
        if (!cancelled) setWeeksFilteredError(e instanceof Error ? e.message : 'Could not load channel analytics.');
      } finally {
        if (!cancelled) setWeeksFilteredLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [departmentFilter, categoryFilter]);

  // "Items sold per week" chart — its own independent department/category filter,
  // defaults to All (no filter).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setItemsSoldLoading(true);
      setItemsSoldError('');
      try {
        const params = new URLSearchParams();
        if (itemsSoldDepartmentFilter) params.set('department_id', itemsSoldDepartmentFilter);
        if (itemsSoldCategoryFilter) params.set('category_id', itemsSoldCategoryFilter);
        const response = await fetch(`${API_BASE}/api/reporting/channel-weekly?${params.toString()}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load channel analytics.');
        setItemsSoldWeeks(Array.isArray(data.weeks) ? data.weeks : []);
      } catch (e) {
        if (!cancelled) setItemsSoldError(e instanceof Error ? e.message : 'Could not load channel analytics.');
      } finally {
        if (!cancelled) setItemsSoldLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemsSoldDepartmentFilter, itemsSoldCategoryFilter]);

  const lineChartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: themeTextRgba(0.85) } },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.raw as number;
              return `${context.dataset.label}: ${formatCurrency(value || 0)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: themeAccentRgba(0.08) },
          ticks: { color: themeTextRgba(0.8), maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: themeAccentRgba(0.12) },
          ticks: {
            color: themeTextRgba(0.75),
            callback(value) {
              return typeof value === 'number' ? formatCurrency(value) : value;
            },
          },
        },
      },
    }),
    []
  );

  // Same as lineChartOptions but for a plain count (items sold), not currency.
  const countLineChartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: themeTextRgba(0.85) } },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.raw as number;
              return `${context.dataset.label}: ${value || 0}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: themeAccentRgba(0.08) },
          ticks: { color: themeTextRgba(0.8), maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          ticks: { color: themeTextRgba(0.75), precision: 0 },
          grid: { color: themeAccentRgba(0.12) },
        },
      },
    }),
    []
  );

  const periodWeeksAll = useMemo(() => aggregateChannelWeeks(weeksAll, period), [weeksAll, period]);
  const periodWeeksFiltered = useMemo(() => aggregateChannelWeeks(weeksFiltered, period), [weeksFiltered, period]);
  const periodItemsSoldWeeks = useMemo(() => aggregateChannelWeeks(itemsSoldWeeks, period), [itemsSoldWeeks, period]);

  const itemsSoldChartData = useMemo(() => {
    if (periodItemsSoldWeeks.length === 0) return null;
    return {
      labels: periodItemsSoldWeeks.map((w) => w.label),
      datasets: [
        {
          label: 'eBay',
          data: periodItemsSoldWeeks.map((w) => w.ebayCount),
          borderColor: CHART_EBAY_YELLOW,
          backgroundColor: CHART_EBAY_YELLOW_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Vinted',
          data: periodItemsSoldWeeks.map((w) => w.vintedCount),
          borderColor: CHART_VINTED_BLUE,
          backgroundColor: CHART_VINTED_BLUE_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        ...(showCombined
          ? [
              {
                label: 'Combined',
                data: periodItemsSoldWeeks.map((w) => w.ebayCount + w.vintedCount),
                borderColor: CHART_COMBINED_GREY,
                backgroundColor: CHART_COMBINED_GREY_FILL,
                tension: 0.3,
                pointRadius: 2,
                borderDash: [6, 4],
              },
            ]
          : []),
      ],
    };
  }, [periodItemsSoldWeeks, showCombined]);

  const itemsSoldCategoryOptions = useMemo(() => {
    const rows = itemsSoldDepartmentFilter
      ? categoryRows.filter((c) => String(c.department_id ?? '') === itemsSoldDepartmentFilter)
      : categoryRows;
    return rows
      .slice()
      .sort((a, b) => a.category_name.localeCompare(b.category_name))
      .map((c) => ({ value: String(c.id), label: c.category_name }));
  }, [categoryRows, itemsSoldDepartmentFilter]);

  const filteredSalesChartData = useMemo(() => {
    if (periodWeeksFiltered.length === 0) return null;
    const ebayOf = (w: ChannelWeeklyPoint) => (totalsMetric === 'items' ? w.ebayCount : w.ebaySales);
    const vintedOf = (w: ChannelWeeklyPoint) => (totalsMetric === 'items' ? w.vintedCount : w.vintedSales);
    return {
      labels: periodWeeksFiltered.map((w) => w.label),
      datasets: [
        {
          label: 'eBay',
          data: periodWeeksFiltered.map(ebayOf),
          borderColor: CHART_EBAY_YELLOW,
          backgroundColor: CHART_EBAY_YELLOW_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Vinted',
          data: periodWeeksFiltered.map(vintedOf),
          borderColor: CHART_VINTED_BLUE,
          backgroundColor: CHART_VINTED_BLUE_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        ...(showCombined
          ? [
              {
                label: 'Combined',
                data: periodWeeksFiltered.map((w) => ebayOf(w) + vintedOf(w)),
                borderColor: CHART_COMBINED_GREY,
                backgroundColor: CHART_COMBINED_GREY_FILL,
                tension: 0.3,
                pointRadius: 2,
                borderDash: [6, 4],
              },
            ]
          : []),
      ],
    };
  }, [periodWeeksFiltered, showCombined, totalsMetric]);

  // This card shows Profit Per Week when the global metric is Sales, and
  // switches to Items Sold Per Week (same unfiltered dataset) when it's Items —
  // profit has no "number of items" equivalent to toggle to.
  const profitChartData = useMemo(() => {
    if (periodWeeksAll.length === 0) return null;
    if (totalsMetric === 'items') {
      return {
        labels: periodWeeksAll.map((w) => w.label),
        datasets: [
          {
            label: 'eBay',
            data: periodWeeksAll.map((w) => w.ebayCount),
            borderColor: CHART_EBAY_YELLOW,
            backgroundColor: CHART_EBAY_YELLOW_FILL,
            tension: 0.3,
            pointRadius: 2,
          },
          {
            label: 'Vinted',
            data: periodWeeksAll.map((w) => w.vintedCount),
            borderColor: CHART_VINTED_BLUE,
            backgroundColor: CHART_VINTED_BLUE_FILL,
            tension: 0.3,
            pointRadius: 2,
          },
          ...(showCombined
            ? [
                {
                  label: 'Combined',
                  data: periodWeeksAll.map((w) => w.ebayCount + w.vintedCount),
                  borderColor: CHART_COMBINED_GREY,
                  backgroundColor: CHART_COMBINED_GREY_FILL,
                  tension: 0.3,
                  pointRadius: 2,
                  borderDash: [6, 4],
                },
              ]
            : []),
        ],
      };
    }
    return {
      labels: periodWeeksAll.map((w) => w.label),
      datasets: [
        {
          label: 'eBay profit',
          data: periodWeeksAll.map((w) => w.ebayProfit),
          borderColor: CHART_EBAY_YELLOW,
          backgroundColor: CHART_EBAY_YELLOW_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Vinted profit',
          data: periodWeeksAll.map((w) => w.vintedProfit),
          borderColor: CHART_VINTED_BLUE,
          backgroundColor: CHART_VINTED_BLUE_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        ...(showCombined
          ? [
              {
                label: 'Combined profit',
                data: periodWeeksAll.map((w) => w.ebayProfit + w.vintedProfit),
                borderColor: CHART_COMBINED_GREY,
                backgroundColor: CHART_COMBINED_GREY_FILL,
                tension: 0.3,
                pointRadius: 2,
                borderDash: [6, 4],
              },
            ]
          : []),
      ],
    };
  }, [periodWeeksAll, showCombined, totalsMetric]);

  const filterCategoryOptions = useMemo(() => {
    const rows = departmentFilter
      ? categoryRows.filter((c) => String(c.department_id ?? '') === departmentFilter)
      : categoryRows;
    return rows
      .slice()
      .sort((a, b) => a.category_name.localeCompare(b.category_name))
      .map((c) => ({ value: String(c.id), label: c.category_name }));
  }, [categoryRows, departmentFilter]);

  const filterDepartmentOptions = useMemo(
    () =>
      departmentRows
        .slice()
        .sort((a, b) => a.department_name.localeCompare(b.department_name))
        .map((d) => ({ value: String(d.id), label: d.department_name })),
    [departmentRows]
  );

  const filteredTotals = useMemo(() => {
    const ebay = periodWeeksFiltered.reduce((sum, w) => sum + (totalsMetric === 'items' ? w.ebayCount : w.ebaySales), 0);
    const vinted = periodWeeksFiltered.reduce((sum, w) => sum + (totalsMetric === 'items' ? w.vintedCount : w.vintedSales), 0);
    const winner: 'eBay' | 'Vinted' | null = ebay === vinted ? null : ebay > vinted ? 'eBay' : 'Vinted';
    return { ebay, vinted, winner };
  }, [periodWeeksFiltered, totalsMetric]);

  const profitTotals = useMemo(() => {
    const ebay = periodWeeksAll.reduce((sum, w) => sum + (totalsMetric === 'items' ? w.ebayCount : w.ebayProfit), 0);
    const vinted = periodWeeksAll.reduce((sum, w) => sum + (totalsMetric === 'items' ? w.vintedCount : w.vintedProfit), 0);
    const winner: 'eBay' | 'Vinted' | null = ebay === vinted ? null : ebay > vinted ? 'eBay' : 'Vinted';
    return { ebay, vinted, winner };
  }, [periodWeeksAll, totalsMetric]);

  const formatTotalsMetric = (value: number) => (totalsMetric === 'items' ? String(value) : formatCurrency(value));

  return (
    <div className="channel-analytics-view">
      <div className="channel-analytics-toolbar">
        <div className="channel-toggle-group" role="group" aria-label="Metric">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${totalsMetric === 'sales' ? 'active' : ''}`}
              aria-pressed={totalsMetric === 'sales'}
              onClick={() => setTotalsMetric('sales')}
            >
              Sales
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${totalsMetric === 'items' ? 'active' : ''}`}
              aria-pressed={totalsMetric === 'items'}
              onClick={() => setTotalsMetric('items')}
            >
              Number of Items Sold
            </button>
          </div>
        </div>
        <div className="channel-toggle-group" role="group" aria-label="Chart type">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${chartType === 'line' ? 'active' : ''}`}
              aria-pressed={chartType === 'line'}
              onClick={() => setChartType('line')}
            >
              Line
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${chartType === 'bar' ? 'active' : ''}`}
              aria-pressed={chartType === 'bar'}
              onClick={() => setChartType('bar')}
            >
              Grouped Columns
            </button>
          </div>
        </div>
        <div className="channel-toggle-group" role="group" aria-label="Combined series">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${showCombined ? 'active' : ''}`}
              aria-pressed={showCombined}
              onClick={() => setShowCombined(true)}
            >
              Show All
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${!showCombined ? 'active' : ''}`}
              aria-pressed={!showCombined}
              onClick={() => setShowCombined(false)}
            >
              Hide Total Data
            </button>
          </div>
        </div>
        <div className="channel-toggle-group" role="group" aria-label="Time period">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${period === 'weekly' ? 'active' : ''}`}
              aria-pressed={period === 'weekly'}
              onClick={() => setPeriod('weekly')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${period === 'monthly' ? 'active' : ''}`}
              aria-pressed={period === 'monthly'}
              onClick={() => setPeriod('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${period === 'bi-monthly' ? 'active' : ''}`}
              aria-pressed={period === 'bi-monthly'}
              onClick={() => setPeriod('bi-monthly')}
            >
              Bi-Monthly
            </button>
          </div>
        </div>
      </div>
      <div className="reporting-grid">
        <section className="reporting-card">
          <div className="card-header">
            <h2>Total {totalsMetric === 'items' ? 'Items Sold' : 'Sales'} By Channel</h2>
          </div>
          <div className="channel-filter-row">
            <StockFormDropdown
              value={departmentFilter}
              options={filterDepartmentOptions}
              onChange={(value) => {
                setDepartmentFilter(value);
                setCategoryFilter('');
              }}
              placeholder="All Departments"
              includeEmptyOption
              ariaLabel="Filter channel analytics by department"
              className="stock-analysis-filter-dropdown"
            />
            <StockFormDropdown
              value={categoryFilter}
              options={filterCategoryOptions}
              onChange={(value) => setCategoryFilter(value)}
              placeholder="All Categories"
              includeEmptyOption
              ariaLabel="Filter channel analytics by category"
              className="stock-analysis-filter-dropdown"
            />
          </div>
          {weeksFilteredError ? (
            <div className="reporting-error">{weeksFilteredError}</div>
          ) : filteredSalesChartData ? (
            <>
              <div className="chart-wrapper">
                {chartType === 'bar' ? (
                  <Bar
                    data={filteredSalesChartData}
                    options={(totalsMetric === 'items' ? countLineChartOptions : lineChartOptions) as unknown as ChartOptions<'bar'>}
                  />
                ) : (
                  <Line data={filteredSalesChartData} options={totalsMetric === 'items' ? countLineChartOptions : lineChartOptions} />
                )}
              </div>
              <div className="channel-summary">
                <div className="channel-summary-stat">
                  <span className="channel-summary-label">eBay total {totalsMetric === 'items' ? 'items sold' : 'sales'}</span>
                  <span className="channel-summary-value">{formatTotalsMetric(filteredTotals.ebay)}</span>
                </div>
                <div className="channel-summary-stat">
                  <span className="channel-summary-label">Vinted total {totalsMetric === 'items' ? 'items sold' : 'sales'}</span>
                  <span className="channel-summary-value">{formatTotalsMetric(filteredTotals.vinted)}</span>
                </div>
              </div>
              <div className="channel-summary-winner">
                {filteredTotals.winner ? `Winner: ${filteredTotals.winner}` : 'It’s a tie'}
              </div>
            </>
          ) : (
            <div className="reporting-empty">
              {weeksFilteredLoading ? 'Loading…' : 'No sales data for this department/category in the last 12 months.'}
            </div>
          )}
        </section>

        <section className="reporting-card">
          <div className="card-header">
            <h2>{totalsMetric === 'items' ? 'Items Sold Per Week By Channel' : 'Profit Per Week By Channel'}</h2>
          </div>
          {weeksAllError ? (
            <div className="reporting-error">{weeksAllError}</div>
          ) : profitChartData ? (
            <>
              <div className="chart-wrapper">
                {chartType === 'bar' ? (
                  <Bar
                    data={profitChartData}
                    options={(totalsMetric === 'items' ? countLineChartOptions : lineChartOptions) as unknown as ChartOptions<'bar'>}
                  />
                ) : (
                  <Line data={profitChartData} options={totalsMetric === 'items' ? countLineChartOptions : lineChartOptions} />
                )}
              </div>
              <div className="channel-summary">
                <div className="channel-summary-stat">
                  <span className="channel-summary-label">eBay total {totalsMetric === 'items' ? 'items sold' : 'profit'}</span>
                  <span className="channel-summary-value">{formatTotalsMetric(profitTotals.ebay)}</span>
                </div>
                <div className="channel-summary-stat">
                  <span className="channel-summary-label">Vinted total {totalsMetric === 'items' ? 'items sold' : 'profit'}</span>
                  <span className="channel-summary-value">{formatTotalsMetric(profitTotals.vinted)}</span>
                </div>
              </div>
              <div className="channel-summary-winner">
                {profitTotals.winner ? `Winner: ${profitTotals.winner}` : 'It’s a tie'}
              </div>
            </>
          ) : (
            <div className="reporting-empty">{weeksAllLoading ? 'Loading…' : 'No data for the last 12 months.'}</div>
          )}
        </section>

        <section className="reporting-card">
          <div className="card-header">
            <h2>Items Sold Per Week By Channel</h2>
          </div>
          <div className="channel-filter-row">
            <StockFormDropdown
              value={itemsSoldDepartmentFilter}
              options={filterDepartmentOptions}
              onChange={(value) => {
                setItemsSoldDepartmentFilter(value);
                setItemsSoldCategoryFilter('');
              }}
              placeholder="All Departments"
              includeEmptyOption
              ariaLabel="Filter items sold per week by department"
              className="stock-analysis-filter-dropdown"
            />
            <StockFormDropdown
              value={itemsSoldCategoryFilter}
              options={itemsSoldCategoryOptions}
              onChange={(value) => setItemsSoldCategoryFilter(value)}
              placeholder="All Categories"
              includeEmptyOption
              ariaLabel="Filter items sold per week by category"
              className="stock-analysis-filter-dropdown"
            />
          </div>
          {itemsSoldError ? (
            <div className="reporting-error">{itemsSoldError}</div>
          ) : itemsSoldChartData ? (
            <div className="chart-wrapper">
              {chartType === 'bar' ? (
                <Bar
                  data={itemsSoldChartData}
                  options={countLineChartOptions as unknown as ChartOptions<'bar'>}
                />
              ) : (
                <Line data={itemsSoldChartData} options={countLineChartOptions} />
              )}
            </div>
          ) : (
            <div className="reporting-empty">
              {itemsSoldLoading ? 'Loading…' : 'No sales data for the last 12 months.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
