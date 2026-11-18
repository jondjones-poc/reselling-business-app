import React, { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import { themeAccentRgba, themeTextRgba } from '../utils/themeColors';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const API_BASE = getApiBase();

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const formatCurrency = (value: number) => currencyFormatter.format(value ?? 0);

const AVOID_COLOR = 'rgba(224, 85, 111, 0.65)';
const AVOID_BORDER = 'rgba(224, 85, 111, 0.95)';
const BUY_COLOR = 'rgba(63, 191, 107, 0.65)';
const BUY_BORDER = 'rgba(63, 191, 107, 0.95)';
const SEASONAL_COLOR = 'rgba(245, 175, 2, 0.6)';
const SEASONAL_BORDER = 'rgba(245, 175, 2, 0.95)';

interface CategoryRow {
  categoryId: number;
  categoryName: string;
  unsoldCount: number;
  soldCount: number;
  recentSoldCount: number;
  priorSoldCount: number;
  avgProfitPerItem: number | null;
  possiblySeasonal: boolean;
  avoidScore: number;
  buyScore: number;
}

function RankedCategoryChart({
  title,
  rows,
  scoreKey,
  scoreLabel,
  solidColor,
  solidBorder,
}: {
  title: string;
  rows: CategoryRow[];
  scoreKey: 'avoidScore' | 'buyScore';
  scoreLabel: string;
  solidColor: string;
  solidBorder: string;
}) {
  const chartData = useMemo(() => {
    if (rows.length === 0) return null;
    return {
      labels: rows.map((r) => r.categoryName + (r.possiblySeasonal ? ' ⚑' : '')),
      datasets: [
        {
          label: scoreLabel,
          data: rows.map((r) => r[scoreKey]),
          backgroundColor: rows.map((r) => (r.possiblySeasonal ? SEASONAL_COLOR : solidColor)),
          borderColor: rows.map((r) => (r.possiblySeasonal ? SEASONAL_BORDER : solidBorder)),
          borderWidth: 1,
        },
      ],
    };
  }, [rows, scoreKey, scoreLabel, solidColor, solidBorder]);

  const chartOptions: ChartOptions<'bar'> = useMemo(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const row = rows[context.dataIndex];
              if (!row) return '';
              const lines = [
                `${scoreLabel}: ${row[scoreKey].toFixed(2)}`,
                `In stock: ${row.unsoldCount}, Sold (lifetime): ${row.soldCount}`,
                `Sold last 120 days: ${row.recentSoldCount}, Sold 120-240 days ago: ${row.priorSoldCount}`,
                `Avg profit/item: ${row.avgProfitPerItem != null ? formatCurrency(row.avgProfitPerItem) : 'n/a'}`,
              ];
              if (row.possiblySeasonal) {
                lines.push('⚑ Sold better 120-240 days ago than recently — could be seasonal, could be a real decline.');
              }
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: themeAccentRgba(0.12) },
          ticks: { color: themeTextRgba(0.75) },
        },
        y: {
          grid: { color: themeAccentRgba(0.08) },
          ticks: { color: themeTextRgba(0.8) },
        },
      },
    }),
    [rows, scoreKey, scoreLabel]
  );

  const chartHeight = Math.max(120, rows.length * 34);

  return (
    <div className="brand-category-avoid-chart-block">
      <h3 className="brand-category-avoid-subheading">{title}</h3>
      {chartData == null ? (
        <div className="reporting-empty">Not enough data to rank any categories here yet.</div>
      ) : (
        <div className="chart-wrapper" style={{ height: chartHeight }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      )}
    </div>
  );
}

export default function BrandCategoryAvoid({
  brandId,
  departmentId,
}: {
  brandId: number;
  departmentId: number | null;
}) {
  const [avoidRows, setAvoidRows] = useState<CategoryRow[]>([]);
  const [buyRows, setBuyRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = departmentId != null ? `?department_id=${departmentId}` : '';
        const response = await fetch(`${API_BASE}/api/brands/${brandId}/category-avoid${qs}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load category breakdown.');
        setAvoidRows(Array.isArray(data.avoidRows) ? data.avoidRows : []);
        setBuyRows(Array.isArray(data.buyRows) ? data.buyRows : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load category breakdown.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, departmentId]);

  return (
    <section className="reporting-card brand-category-avoid-card">
      <div className="card-header">
        <h2>Categories: Buy vs Avoid</h2>
        <button type="button" className="brand-avoid-score-trigger" onClick={() => setShowInfo((v) => !v)}>
          How is this worked out? ⓘ
        </button>
      </div>
      {error ? (
        <div className="reporting-error">{error}</div>
      ) : loading ? (
        <div className="reporting-empty">Loading…</div>
      ) : (
        <>
          <RankedCategoryChart
            title="Categories To Avoid (worst first)"
            rows={avoidRows}
            scoreKey="avoidScore"
            scoreLabel="Avoid score"
            solidColor={AVOID_COLOR}
            solidBorder={AVOID_BORDER}
          />
          <RankedCategoryChart
            title="Categories To Buy (best first)"
            rows={buyRows}
            scoreKey="buyScore"
            scoreLabel="Buy score"
            solidColor={BUY_COLOR}
            solidBorder={BUY_BORDER}
          />
          <p className="brand-tag-examples-muted brand-category-avoid-legend">
            ⚑ amber bars sold better 120-240 days ago than in the last 120 days — could just be
            seasonal (worth a manual look) rather than a genuine change in popularity.
          </p>
        </>
      )}
      {showInfo && (
        <div className="brand-avoid-score-modal-backdrop" onClick={() => setShowInfo(false)} role="presentation">
          <div
            className="reporting-card brand-avoid-score-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="card-header">
              <h3>How these category scores are worked out</h3>
              <button
                type="button"
                className="brand-avoid-score-info-close"
                onClick={() => setShowInfo(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p>
              Same idea as Brands To Avoid, but one level down — ranking this brand's own
              categories (e.g. Coats vs Shorts) instead of brands, in both directions.
            </p>
            <p>
              <code>Avoid score = In stock × Slow-selling factor × Profit shortfall</code>
            </p>
            <ul>
              <li>
                <strong>In stock</strong> — unsold items in this category. Used as-is, so a
                category with 1-2 unsold items barely scores even if everything else looks bad.
              </li>
              <li>
                <strong>Slow-selling factor</strong> (0 to 1) ={' '}
                <code>1 − min(1, sold in last 120 days ÷ in stock)</code>.
              </li>
              <li>
                <strong>Profit shortfall</strong> ={' '}
                <code>max(0, (£10 − average profit per item) ÷ £10)</code>. At or above £10 this
                is 0, which collapses the whole score to 0 — a profitable category isn't flagged
                just for being a slow mover.
              </li>
            </ul>
            <p>
              <code>Buy score = (best of last-120-day or prior-120-day sales ÷ (in stock + 1)) × Profit factor</code>
            </p>
            <ul>
              <li>
                Using whichever of the two 120-day windows sold more means a seasonal item still
                scores well in its off-season, rather than looking dead.
              </li>
              <li>
                <strong>Profit factor</strong> is 1 at/above £10/item, and scales down to a floor
                of 0.3 below that — a fast seller at a thinner margin can still be worth
                restocking, just not as strongly recommended as one that's both fast and
                profitable.
              </li>
            </ul>
            <p>
              Categories with fewer than 2 recorded items are left out of both rankings — not
              enough data to call either way.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
