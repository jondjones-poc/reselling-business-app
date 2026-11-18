import React, { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import { themeAccentRgba, themeTextRgba } from '../utils/themeColors';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const API_BASE = getApiBase();

const CHART_EBAY_YELLOW = '#F5AF02';
const CHART_EBAY_YELLOW_FILL = 'rgba(245, 175, 2, 0.65)';
const CHART_VINTED_BLUE = '#09B1BA';
const CHART_VINTED_BLUE_FILL = 'rgba(9, 177, 186, 0.65)';

type Period = 'weekly' | 'monthly';
type Metric = 'items' | 'profit';

interface ChannelSaleRow {
  saleDate: string | null;
  salePrice: number | null;
  purchasePrice: number | null;
  soldPlatform: string | null;
}

/** Monday (UTC) of the week containing this date-only string. */
function mondayOfWeek(dateOnly: string): Date {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function bucketKeyAndLabel(dateOnly: string, period: Period): { key: string; label: string } {
  if (period === 'weekly') {
    const monday = mondayOfWeek(dateOnly);
    const key = monday.toISOString().slice(0, 10);
    const label = monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
    return { key, label };
  }
  const d = new Date(`${dateOnly}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { key, label };
}

/** Every bucket key+label from `fromDateOnly` through `toDateOnly` (inclusive),
 * stepping one week/month at a time — so a channel that's stopped selling still
 * shows the current, empty week/month rather than just stopping at its last sale. */
function enumerateBuckets(fromDateOnly: string, toDateOnly: string, period: Period): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (period === 'weekly') {
    const cursor = mondayOfWeek(fromDateOnly);
    const end = mondayOfWeek(toDateOnly);
    while (cursor.getTime() <= end.getTime()) {
      out.push(bucketKeyAndLabel(cursor.toISOString().slice(0, 10), period));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return out;
  }
  const start = new Date(`${fromDateOnly}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endDate = new Date(`${toDateOnly}T00:00:00Z`);
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    out.push(bucketKeyAndLabel(cursor.toISOString().slice(0, 10), period));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function buildChannelSeries(rows: ChannelSaleRow[], period: Period, metric: Metric) {
  const ebay = new Map<string, number>();
  const vinted = new Map<string, number>();

  let earliest: string | null = null;
  for (const row of rows) {
    if (!row.saleDate || !row.soldPlatform) continue;
    const { key } = bucketKeyAndLabel(row.saleDate, period);
    const value =
      metric === 'items'
        ? 1
        : row.salePrice != null && row.purchasePrice != null
          ? row.salePrice - row.purchasePrice
          : 0;
    if (row.soldPlatform === 'ebay') {
      ebay.set(key, (ebay.get(key) ?? 0) + value);
    } else if (row.soldPlatform === 'vinted') {
      vinted.set(key, (vinted.get(key) ?? 0) + value);
    } else {
      continue;
    }
    if (earliest == null || row.saleDate < earliest) earliest = row.saleDate;
  }

  if (earliest == null) {
    return { labels: [], ebay: [], vinted: [] };
  }

  // Always run through today, not just the last period with a sale — a channel
  // that's stopped selling should show as a flat line at the present, not as
  // the chart simply stopping at its last sale.
  const today = new Date().toISOString().slice(0, 10);
  const buckets = enumerateBuckets(earliest, today, period);
  return {
    labels: buckets.map((b) => b.label),
    ebay: buckets.map((b) => ebay.get(b.key) ?? 0),
    vinted: buckets.map((b) => vinted.get(b.key) ?? 0),
  };
}

export default function BrandChannelTrendChart({
  brandId,
  departmentId,
}: {
  brandId: number;
  /** null combines every department this brand name sells under. */
  departmentId: number | null;
}) {
  const [rows, setRows] = useState<ChannelSaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('monthly');
  const [metric, setMetric] = useState<Metric>('items');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = departmentId != null ? `?department_id=${departmentId}` : '';
        const response = await fetch(`${API_BASE}/api/brands/${brandId}/purchase-sale-dates${qs}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load sales-by-channel history.');
        setRows(Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load sales-by-channel history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, departmentId]);

  const series = useMemo(() => buildChannelSeries(rows, period, metric), [rows, period, metric]);

  const chartOptions: ChartOptions<'line'> = useMemo(
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
              return metric === 'items'
                ? `${context.dataset.label}: ${value || 0}`
                : `${context.dataset.label}: ${new Intl.NumberFormat('en-GB', {
                    style: 'currency',
                    currency: 'GBP',
                  }).format(value || 0)}`;
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
          ticks: {
            color: themeTextRgba(0.75),
            precision: metric === 'items' ? 0 : undefined,
            callback(value) {
              if (metric === 'items') return value;
              return typeof value === 'number'
                ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
                : value;
            },
          },
          grid: { color: themeAccentRgba(0.12) },
        },
      },
    }),
    [metric]
  );

  const chartData = useMemo(() => {
    if (series.labels.length === 0) return null;
    return {
      labels: series.labels,
      datasets: [
        {
          label: 'eBay',
          data: series.ebay,
          borderColor: CHART_EBAY_YELLOW,
          backgroundColor: CHART_EBAY_YELLOW_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Vinted',
          data: series.vinted,
          borderColor: CHART_VINTED_BLUE,
          backgroundColor: CHART_VINTED_BLUE_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    };
  }, [series]);

  return (
    <section className="reporting-card brand-research-bought-vs-sold-card">
      <div className="card-header">
        <h2>Sales by Channel</h2>
      </div>
      <div className="channel-analytics-toolbar brand-research-channel-trend-toolbar">
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
          </div>
        </div>
        <div className="channel-toggle-group" role="group" aria-label="Metric">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${metric === 'items' ? 'active' : ''}`}
              aria-pressed={metric === 'items'}
              onClick={() => setMetric('items')}
            >
              Number of Items
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${metric === 'profit' ? 'active' : ''}`}
              aria-pressed={metric === 'profit'}
              onClick={() => setMetric('profit')}
            >
              Profit
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <div className="reporting-error">{error}</div>
      ) : chartData ? (
        <div className="chart-wrapper">
          <Line data={chartData} options={chartOptions} />
        </div>
      ) : (
        <div className="reporting-empty">
          {loading ? 'Loading…' : 'No sales history for this brand yet.'}
        </div>
      )}
    </section>
  );
}
