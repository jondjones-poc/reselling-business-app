import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { apiUrl } from '../utils/apiBase';
import { useTheme } from '../context/ThemeContext';
import { themeAccentRgba, themeTextRgba } from '../utils/themeColors';
import './ResearchTagSellThrough.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** Same defaults as eBay tag feed — filters live on that tab only. */
const DEFAULT_MIN_PRICE_GBP = 50;
const DEFAULT_MAX_PRICE_GBP = 200;
const SOLD_DAYS = 180;

type TagStatsRow = {
  tagId: number;
  term: string;
  activeCount: number | null;
  soldCount: number | null;
  sellThroughRatio: number | null;
  fetchedAt: string | null;
  cached?: boolean;
  error?: string | null;
  fetchError?: string | null;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function formatSellThrough(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  if (pct > 999) return '999%+';
  if (pct > 100) return `${pct.toFixed(0)}%+`;
  return `${pct.toFixed(1)}%`;
}

function sellThroughTone(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '';
  if (ratio < 0.15) return ' research-tag-str-pct--low';
  if (ratio < 0.35) return ' research-tag-str-pct--mid';
  return ' research-tag-str-pct--high';
}

function useTagStrChartOptions(): ChartOptions<'bar'> {
  const { colorScheme } = useTheme();
  return useMemo(
    (): ChartOptions<'bar'> => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              return n.toLocaleString('en-GB');
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: themeTextRgba(0.88),
            font: { size: 12, weight: 'bold' },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: themeTextRgba(0.75),
            precision: 0,
          },
          grid: { color: themeAccentRgba(0.1) },
        },
      },
    }),
    [colorScheme]
  );
}

type TagStrChartCardProps = {
  row: TagStatsRow;
  soldDays: number;
  toneIndex: number;
};

const TagStrChartCard: React.FC<TagStrChartCardProps> = ({ row, soldDays, toneIndex }) => {
  const chartOptions = useTagStrChartOptions();
  const chartData = useMemo(
    () => ({
      labels: ['Active', `Sold (${soldDays}d)`],
      datasets: [
        {
          label: 'Listings',
          data: [row.activeCount ?? 0, row.soldCount ?? 0],
          backgroundColor: ['rgba(56, 189, 248, 0.75)', 'rgba(130, 210, 155, 0.82)'],
          borderColor: ['rgba(125, 211, 252, 0.95)', 'rgba(180, 235, 200, 0.95)'],
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    }),
    [row.activeCount, row.soldCount, soldDays]
  );

  const err = row.error || row.fetchError;

  return (
    <article
      className={`research-tag-str-card research-tag-str-card--tone-${toneIndex % 6}`}
      aria-labelledby={`tag-str-title-${row.tagId}`}
    >
      <div className="research-tag-str-card-head">
        <h2 id={`tag-str-title-${row.tagId}`} className="research-tag-str-card-title">
          {row.term}
        </h2>
        <span
          className={`research-tag-str-pct${sellThroughTone(row.sellThroughRatio)}`}
          title="Sell-through (sold ÷ active)"
        >
          {formatSellThrough(row.sellThroughRatio)}
        </span>
      </div>
      {err ? (
        <p className="research-tag-str-card-error" role="alert">
          {err}
        </p>
      ) : (
        <div className="research-tag-str-chart-wrap">
          <Bar data={chartData} options={chartOptions} />
        </div>
      )}
    </article>
  );
};

const ResearchTagSellThrough: React.FC = () => {
  const [rows, setRows] = useState<TagStatsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAllStats = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        minPriceGbp: String(DEFAULT_MIN_PRICE_GBP),
        maxPriceGbp: String(DEFAULT_MAX_PRICE_GBP),
        soldDays: String(SOLD_DAYS),
      });
      if (forceRefresh) params.set('refresh', '1');
      const res = await fetch(apiUrl(`/api/research-feed/tag-stats?${params.toString()}`));
      const data = await readJson<{
        rows?: TagStatsRow[];
        error?: string;
        details?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || data.details || res.statusText);
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tag stats');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAllStats(false);
  }, [loadAllStats]);

  const handleRefresh = useCallback(async () => {
    try {
      await fetch(apiUrl('/api/research-feed/tag-stats/cache'), { method: 'DELETE' });
    } catch {
      /* non-fatal */
    }
    await loadAllStats(true);
  }, [loadAllStats]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ra = a.sellThroughRatio;
      const rb = b.sellThroughRatio;
      if (ra == null && rb == null) return a.term.localeCompare(b.term);
      if (ra == null) return 1;
      if (rb == null) return -1;
      return rb - ra;
    });
  }, [rows]);

  return (
    <div className="research-tag-str">
      {error && (
        <div className="research-tag-str-banner research-tag-str-banner--error" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="research-tag-str-grid" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="research-tag-str-skeleton" />
          ))}
        </div>
      )}

      {!loading && !error && sortedRows.length === 0 && (
        <p className="research-tag-str-muted">
          No feed tags yet. Add tags on the eBay tag feed tab, then return here for sell-through charts.
        </p>
      )}

      {!loading && sortedRows.length > 0 && (
        <div className="research-tag-str-grid">
          {sortedRows.map((row, i) => (
            <TagStrChartCard key={row.tagId} row={row} soldDays={SOLD_DAYS} toneIndex={i} />
          ))}
        </div>
      )}

      {!loading && (
        <footer className="research-tag-str-footer">
          <button
            type="button"
            className="research-tag-str-refresh-btn"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing from eBay…' : 'Refresh stats from eBay'}
          </button>
        </footer>
      )}
    </div>
  );
};

export default ResearchTagSellThrough;
