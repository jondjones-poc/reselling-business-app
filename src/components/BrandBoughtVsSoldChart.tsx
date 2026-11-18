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

const CHART_BOUGHT_RED = '#E0556F';
const CHART_BOUGHT_RED_FILL = 'rgba(224, 85, 111, 0.65)';
const CHART_SOLD_GREEN = '#3FBF6B';
const CHART_SOLD_GREEN_FILL = 'rgba(63, 191, 107, 0.65)';
const CHART_INVENTORY_BLUE = '#4A90D9';
const CHART_INVENTORY_BLUE_FILL = 'rgba(74, 144, 217, 0.65)';

type Period = 'weekly' | 'monthly';

interface PurchaseSaleDateRow {
  purchaseDate: string | null;
  saleDate: string | null;
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
 * stepping one week/month at a time — so a brand that's stopped selling still
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

function buildSeries(rows: PurchaseSaleDateRow[], period: Period) {
  const bought = new Map<string, number>();
  const sold = new Map<string, number>();

  let earliest: string | null = null;
  for (const row of rows) {
    if (row.purchaseDate) {
      const { key } = bucketKeyAndLabel(row.purchaseDate, period);
      bought.set(key, (bought.get(key) ?? 0) + 1);
      if (earliest == null || row.purchaseDate < earliest) earliest = row.purchaseDate;
    }
    if (row.saleDate) {
      const { key } = bucketKeyAndLabel(row.saleDate, period);
      sold.set(key, (sold.get(key) ?? 0) + 1);
      if (earliest == null || row.saleDate < earliest) earliest = row.saleDate;
    }
  }

  if (earliest == null) {
    return { labels: [], bought: [], sold: [], inventory: [] };
  }

  // Always run through today, not just the last period with data — a brand
  // that's stopped selling should show as a flat line at the present, not as
  // the chart simply stopping at its last sale.
  const today = new Date().toISOString().slice(0, 10);
  const buckets = enumerateBuckets(earliest, today, period);
  const boughtSeries = buckets.map((b) => bought.get(b.key) ?? 0);
  const soldSeries = buckets.map((b) => sold.get(b.key) ?? 0);
  // Running stock level: everything bought so far minus everything sold so far,
  // as of the end of each period — not another per-period count like the other
  // two lines, but a cumulative snapshot of how much is sitting in inventory.
  let running = 0;
  const inventorySeries = boughtSeries.map((boughtCount, i) => {
    running += boughtCount - soldSeries[i];
    return running;
  });
  return {
    labels: buckets.map((b) => b.label),
    bought: boughtSeries,
    sold: soldSeries,
    inventory: inventorySeries,
  };
}

export default function BrandBoughtVsSoldChart({
  brandId,
  departmentId,
}: {
  brandId: number;
  /** null combines every department this brand name sells under. */
  departmentId: number | null;
}) {
  const [rows, setRows] = useState<PurchaseSaleDateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('weekly');

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
        if (!response.ok) throw new Error(data.error || 'Could not load bought/sold history.');
        setRows(Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load bought/sold history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, departmentId]);

  const series = useMemo(() => buildSeries(rows, period), [rows, period]);

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

  const chartData = useMemo(() => {
    if (series.labels.length === 0) return null;
    return {
      labels: series.labels,
      datasets: [
        {
          label: 'Items Bought',
          data: series.bought,
          borderColor: CHART_BOUGHT_RED,
          backgroundColor: CHART_BOUGHT_RED_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Items Sold',
          data: series.sold,
          borderColor: CHART_SOLD_GREEN,
          backgroundColor: CHART_SOLD_GREEN_FILL,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Items in Inventory',
          data: series.inventory,
          borderColor: CHART_INVENTORY_BLUE,
          backgroundColor: CHART_INVENTORY_BLUE_FILL,
          tension: 0.3,
          pointRadius: 2,
          borderDash: [6, 4],
        },
      ],
    };
  }, [series]);

  return (
    <section className="reporting-card brand-research-bought-vs-sold-card">
      <div className="card-header">
        <h2>Bought vs Sold</h2>
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
          {loading ? 'Loading…' : 'No purchase or sale history for this brand yet.'}
        </div>
      )}
    </section>
  );
}
