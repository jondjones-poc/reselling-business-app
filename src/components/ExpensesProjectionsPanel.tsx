import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import { themeAccentRgba, themePositiveRgba, themeTextRgba } from '../utils/themeColors';
import './Stock.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
  Legend
);

type Nullable<T> = T | null | undefined;
type ProjectionsView = 'sales' | 'profit' | 'listing-goal';

interface ProjectionsMonthDatum {
  month: number;
  label: string;
  profitActual: number | null;
  salesActual: number | null;
  itemsSold: number | null;
  salesProjected: number | null;
  profitProjected: number | null;
}

interface ProjectionsApiResponse {
  year: number;
  currentMonth: number;
  calendarYear: number;
  months: ProjectionsMonthDatum[];
  summary: {
    profitYtd: number;
    salesYtd: number;
    itemsSoldYtd: number;
    avgMonthlyProfit: number;
    avgMonthlySales: number;
    projectedYearEndProfit: number;
    projectedYearEndSales: number;
    remainingMonths: number;
  };
  purchases: {
    total: number;
    weeksUsedForAverage: number;
    perWeekAverage: number;
    byWeek: { week: number; count: number }[];
    targetPerWeek: number;
  };
  purchasesYearToDate: {
    year: number;
    total: number;
    weeksUsedForAverage: number;
    perWeekAverage: number;
  };
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
    minimumFractionDigits: 2,
  }).format(parsed);
};

function buildSalesChartOptions(): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: themeTextRgba(0.85),
          boxWidth: 14,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const raw = ctx.raw;
            if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) {
              return '';
            }
            return `${ctx.dataset.label ?? ''}: ${formatCurrency(Number(raw))}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: themeAccentRgba(0.08) },
        ticks: { color: themeTextRgba(0.8) },
      },
      y: {
        beginAtZero: true,
        grid: { color: themeAccentRgba(0.12) },
        ticks: {
          color: themeTextRgba(0.75),
          callback(value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return String(value);
          },
        },
        title: {
          display: true,
          text: 'Projected sales (£)',
          color: themeTextRgba(0.55),
          font: { size: 11 },
        },
      },
    },
  };
}

function buildProfitChartOptions(): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: themeTextRgba(0.85),
          boxWidth: 14,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const raw = ctx.raw;
            if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) {
              return '';
            }
            return `${ctx.dataset.label ?? ''}: ${formatCurrency(Number(raw))}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: themeAccentRgba(0.08) },
        ticks: { color: themeTextRgba(0.8) },
      },
      y: {
        beginAtZero: true,
        grid: { color: themeAccentRgba(0.12) },
        ticks: {
          color: themeTextRgba(0.75),
          callback(value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return String(value);
          },
        },
        title: {
          display: true,
          text: 'Profit (£)',
          color: themeTextRgba(0.55),
          font: { size: 11 },
        },
      },
    },
  };
}

function buildProfitLineChartOptions(): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: themeTextRgba(0.85),
          boxWidth: 14,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const raw = ctx.raw;
            if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) {
              return '';
            }
            return `${ctx.dataset.label ?? ''}: ${formatCurrency(Number(raw))}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: themeAccentRgba(0.08) },
        ticks: { color: themeTextRgba(0.8) },
      },
      y: {
        beginAtZero: true,
        grid: { color: themeAccentRgba(0.12) },
        ticks: {
          color: themeTextRgba(0.75),
          callback(value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return String(value);
          },
        },
        title: {
          display: true,
          text: 'Cumulative profit (£)',
          color: themeTextRgba(0.55),
          font: { size: 11 },
        },
      },
    },
  };
}

function buildListingGoalChartOptions(): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: themeTextRgba(0.85),
          boxWidth: 14,
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label(ctx) {
            const raw = ctx.raw;
            if (raw === null || raw === undefined || (typeof raw === 'number' && Number.isNaN(raw))) {
              return '';
            }
            const n = Math.round(Number(raw));
            return `${ctx.dataset.label ?? ''}: ${n.toLocaleString()} listings`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: themeAccentRgba(0.08) },
        ticks: {
          color: themeTextRgba(0.8),
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 14,
        },
      },
      y: {
        beginAtZero: true,
        grid: { color: themeAccentRgba(0.12) },
        ticks: {
          color: themeTextRgba(0.75),
          precision: 0,
        },
        title: {
          display: true,
          text: 'Cumulative listings',
          color: themeTextRgba(0.55),
          font: { size: 11 },
        },
      },
    },
  };
}

/** Monday on or before the first day of the app's 7-day bucket (week 1 = DOY 1–7). */
function mondayWeekCommencingForBucket(calendarYear: number, weekBucket: number): Date {
  const startDoy = (weekBucket - 1) * 7 + 1;
  const d = new Date(calendarYear, 0, 1);
  d.setDate(d.getDate() + startDoy - 1);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
}

function formatWeekCommencingDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function currentWeekBucketForYear(year: number, now = new Date()): number {
  if (now.getFullYear() < year) return 0;
  if (now.getFullYear() > year) {
    return Math.ceil((isLeapYear(year) ? 366 : 365) / 7);
  }
  const start = new Date(year, 0, 1);
  const days = Math.floor((now.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.ceil(days / 7));
}

export interface ExpensesProjectionsPanelProps {
  labelledBy?: string;
}

export const ExpensesProjectionsPanel: React.FC<ExpensesProjectionsPanelProps> = ({
  labelledBy = 'expenses-tab-projections',
}) => {
  const API_BASE_LOCAL = getApiBase();
  const cy = new Date().getFullYear();
  const [year, setYear] = useState(cy);
  const [view, setView] = useState<ProjectionsView>('sales');
  const [data, setData] = useState<ProjectionsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [projError, setProjError] = useState<string | null>(null);
  const [listingGoalPerDay, setListingGoalPerDay] = useState('5');

  const yearChoices = useMemo(() => [cy, cy - 1, cy - 2, cy - 3, cy - 4], [cy]);

  const load = useCallback(async () => {
    setLoading(true);
    setProjError(null);
    try {
      const res = await fetch(`${API_BASE_LOCAL}/api/expenses/projections?year=${year}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to load projections');
      }
      const json: ProjectionsApiResponse = await res.json();
      setData(json);
    } catch (e) {
      setData(null);
      setProjError(e instanceof Error ? e.message : 'Unable to load projections');
    } finally {
      setLoading(false);
    }
  }, [API_BASE_LOCAL, year]);

  useEffect(() => {
    load();
  }, [load]);

  const salesChartData = useMemo(() => {
    if (!data) {
      return null;
    }
    // Single series: actual sales for elapsed months, projected run-rate for remaining months.
    const values = data.months.map((m) =>
      m.salesProjected != null
        ? m.salesProjected
        : m.salesActual != null
          ? m.salesActual
          : null
    );
    const colors = data.months.map((m) =>
      m.salesProjected != null ? themeAccentRgba(0.35) : themeAccentRgba(0.65)
    );
    const borders = data.months.map((m) =>
      m.salesProjected != null ? themeAccentRgba(0.7) : themeAccentRgba(0.95)
    );
    return {
      labels: data.months.map((m) => m.label),
      datasets: [
        {
          label: 'Projected sales',
          data: values,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: 1,
        },
      ],
    };
  }, [data]);

  const salesChartOptions = useMemo(() => buildSalesChartOptions(), []);

  const hasProfitProjected = data?.months.some((m) => m.profitProjected != null) ?? false;

  const profitChartData = useMemo(() => {
    if (!data) {
      return null;
    }
    const datasets = [
      {
        label: 'Profit (actual)',
        data: data.months.map((m) => (m.profitActual != null ? m.profitActual : null)),
        backgroundColor: themePositiveRgba(0.55),
        borderColor: themePositiveRgba(0.9),
        borderWidth: 1,
      },
    ];
    if (hasProfitProjected) {
      datasets.push({
        label: 'Projected profit',
        data: data.months.map((m) => (m.profitProjected != null ? m.profitProjected : null)),
        backgroundColor: themeAccentRgba(0.35),
        borderColor: themeAccentRgba(0.8),
        borderWidth: 1,
      });
    }
    return {
      labels: data.months.map((m) => m.label),
      datasets,
    };
  }, [data, hasProfitProjected]);

  const profitChartOptions = useMemo(() => buildProfitChartOptions(), []);

  const profitLineChart = useMemo(() => {
    if (!data) {
      return null;
    }
    let running = 0;
    const cumulativeActual: (number | null)[] = [];
    const cumulativeProjected: (number | null)[] = [];
    let hitProjection = false;

    for (const m of data.months) {
      if (m.profitActual != null) {
        running += m.profitActual;
        cumulativeActual.push(running);
        cumulativeProjected.push(null);
      } else if (m.profitProjected != null) {
        if (!hitProjection) {
          cumulativeProjected[cumulativeProjected.length - 1] = running;
          hitProjection = true;
        }
        running += m.profitProjected;
        cumulativeActual.push(null);
        cumulativeProjected.push(running);
      } else {
        cumulativeActual.push(null);
        cumulativeProjected.push(null);
      }
    }

    return {
      labels: data.months.map((m) => m.label),
      datasets: [
        {
          label: 'Cumulative profit (actual)',
          data: cumulativeActual,
          borderColor: themePositiveRgba(0.95),
          backgroundColor: themePositiveRgba(0.12),
          pointRadius: 3,
          borderWidth: 2.5,
          tension: 0.2,
          spanGaps: false,
        },
        {
          label: 'Cumulative profit (projected)',
          data: cumulativeProjected,
          borderColor: themeAccentRgba(0.9),
          backgroundColor: 'transparent',
          pointRadius: 2,
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.2,
          spanGaps: false,
        },
      ],
    };
  }, [data]);

  const monthlySalesRows = useMemo(() => {
    if (!data) return [];
    return data.months.map((m) => ({
      label: m.label,
      sales: m.salesActual,
      profit: m.profitActual,
      itemsSold: m.itemsSold,
      salesProjected: m.salesProjected,
      profitProjected: m.profitProjected,
    }));
  }, [data]);

  const listingGoalChartOptions = useMemo(() => buildListingGoalChartOptions(), []);
  const profitLineChartOptions = useMemo(() => buildProfitLineChartOptions(), []);

  const listingGoalParsed = parseFloat(listingGoalPerDay.trim());
  const listingGoalValid = Number.isFinite(listingGoalParsed) && listingGoalParsed >= 0;
  const weeklyListingTargetFromGoal =
    listingGoalValid && listingGoalParsed > 0 ? listingGoalParsed * 7 : null;

  const listingGoalFrame = useMemo(() => {
    if (!data) {
      return null;
    }
    const y = data.year;
    const now = new Date();
    const monthIndex = now.getMonth() + 1;
    const daysInMonth = new Date(y, monthIndex, 0).getDate();
    const daysInYear = isLeapYear(y) ? 366 : 365;
    const monthLabel = new Date(Date.UTC(y, monthIndex - 1, 1)).toLocaleString('en-GB', {
      month: 'long',
      year: 'numeric',
    });
    return { monthLabel, daysInMonth, daysInYear, year: y };
  }, [data]);

  const listingGoalValues = useMemo(() => {
    if (!listingGoalFrame || !listingGoalValid) {
      return null;
    }
    const perDay = listingGoalParsed;
    return {
      monthTotal: Math.round(perDay * listingGoalFrame.daysInMonth),
      yearTotal: Math.round(perDay * listingGoalFrame.daysInYear),
      perDay,
    };
  }, [listingGoalFrame, listingGoalParsed, listingGoalValid]);

  type PaceTone = 'green' | 'amber' | 'red' | 'muted';

  const listingGoalPaceStatus = useMemo((): {
    tone: PaceTone;
    headline: string;
    meta: string;
  } | null => {
    if (!data) {
      return null;
    }
    if (!listingGoalValid || listingGoalParsed <= 0) {
      return {
        tone: 'muted',
        headline: '—',
        meta: 'Set a listing goal',
      };
    }

    const calendarYear = data.purchasesYearToDate.year;
    const now = new Date();
    const yearStart = new Date(calendarYear, 0, 1);
    const yearEnd = new Date(calendarYear, 11, 31, 23, 59, 59, 999);
    let end = now.getTime() < yearStart.getTime() ? yearStart : now;
    if (end.getTime() > yearEnd.getTime()) {
      end = yearEnd;
    }
    const daysElapsed = Math.max(1, Math.floor((end.getTime() - yearStart.getTime()) / 86400000) + 1);
    const expectedYtd = listingGoalParsed * daysElapsed;
    const actualYtd = data.purchasesYearToDate.total;
    const ratio = expectedYtd > 0 ? actualYtd / expectedYtd : 0;
    const expectedRounded = Math.round(expectedYtd);
    const pctVsPace = Math.round((ratio - 1) * 100);

    if (ratio >= 1.15) {
      return {
        tone: 'green',
        headline: 'On track',
        meta: `${pctVsPace >= 0 ? '+' : ''}${pctVsPace}% vs expected YTD (${expectedRounded.toLocaleString()} at ${listingGoalParsed}/day)`,
      };
    }
    if (ratio >= 1) {
      return {
        tone: 'amber',
        headline: 'On pace',
        meta: `${actualYtd.toLocaleString()} of ~${expectedRounded.toLocaleString()} expected by day ${daysElapsed}`,
      };
    }
    return {
      tone: 'red',
      headline: 'Behind',
      meta: `${actualYtd.toLocaleString()} vs ~${expectedRounded.toLocaleString()} expected YTD (${listingGoalParsed}/day)`,
    };
  }, [data, listingGoalParsed, listingGoalValid]);

  const purchaseWeekTableRows = useMemo(() => {
    if (!data?.purchases.byWeek.length) {
      return [];
    }
    const y = data.year;
    const daysInYear = isLeapYear(y) ? 366 : 365;
    const sorted = [...data.purchases.byWeek].sort((a, b) => a.week - b.week);
    let cumulative = 0;
    return sorted.map((row) => {
      cumulative += row.count;
      const daysThroughWeek = Math.min(row.week * 7, daysInYear);
      const cumulativeGoal =
        listingGoalValid && listingGoalParsed > 0
          ? Math.round(listingGoalParsed * daysThroughWeek)
          : null;
      const vsTarget = cumulativeGoal != null ? cumulative - cumulativeGoal : null;
      return {
        week: row.week,
        count: row.count,
        cumulative,
        cumulativeGoal,
        vsTarget,
        commencingLabel: formatWeekCommencingDate(mondayWeekCommencingForBucket(y, row.week)),
      };
    });
  }, [data, listingGoalParsed, listingGoalValid]);

  const listingGoalLineChart = useMemo(() => {
    if (!data || !listingGoalFrame) {
      return null;
    }

    const y = data.year;
    const daysInYear = listingGoalFrame.daysInYear;
    const weekCount = Math.ceil(daysInYear / 7);
    const currentWeek = currentWeekBucketForYear(y);
    const countsByWeek = new Map(data.purchases.byWeek.map((row) => [row.week, row.count]));

    const labels: string[] = [];
    const actualCumulative: (number | null)[] = [];
    const goalCumulative: (number | null)[] = [];
    const projectedCumulative: (number | null)[] = [];

    let runningActual = 0;
    const now = new Date();
    const yearStart = new Date(y, 0, 1);
    let daysElapsed = 0;
    if (now.getFullYear() === y) {
      daysElapsed = Math.max(1, Math.floor((now.getTime() - yearStart.getTime()) / 86400000) + 1);
    } else if (now.getFullYear() > y) {
      daysElapsed = daysInYear;
    }

    const actualYtd = data.year === data.calendarYear ? data.purchasesYearToDate.total : data.purchases.total;
    const goalPerDay = listingGoalValid && listingGoalParsed > 0 ? listingGoalParsed : 0;

    for (let week = 1; week <= weekCount; week += 1) {
      labels.push(`W${week}`);
      const daysThroughWeek = Math.min(week * 7, daysInYear);
      const goalValue = goalPerDay > 0 ? Math.round(goalPerDay * daysThroughWeek) : null;
      goalCumulative.push(goalValue);

      if (week <= currentWeek) {
        runningActual += countsByWeek.get(week) ?? 0;
        // Prefer YTD total on the current week so the tip matches the summary card.
        actualCumulative.push(week === currentWeek ? actualYtd : runningActual);
        projectedCumulative.push(week === currentWeek ? actualYtd : null);
      } else {
        actualCumulative.push(null);
        if (goalPerDay > 0 && currentWeek > 0) {
          const daysAhead = Math.max(0, daysThroughWeek - daysElapsed);
          projectedCumulative.push(Math.round(actualYtd + goalPerDay * daysAhead));
        } else {
          projectedCumulative.push(null);
        }
      }
    }

    return {
      labels,
      datasets: [
        {
          label: 'Actual cumulative',
          data: actualCumulative,
          borderColor: themePositiveRgba(0.95),
          backgroundColor: themePositiveRgba(0.18),
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2.5,
          tension: 0.2,
          spanGaps: false,
        },
        {
          label: 'Listing goal',
          data: goalCumulative,
          borderColor: themeAccentRgba(0.85),
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.15,
          spanGaps: false,
        },
        {
          label: 'Forward at goal pace',
          data: projectedCumulative,
          borderColor: themeTextRgba(0.55),
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [2, 4],
          tension: 0.15,
          spanGaps: false,
        },
      ],
    };
  }, [data, listingGoalFrame, listingGoalParsed, listingGoalValid]);

  return (
    <div className="expenses-projections" role="tabpanel" aria-labelledby={labelledBy}>
      <div className="expenses-projections-top">
        <div
          className="expenses-projections-view-toggle"
          role="group"
          aria-label="Projections view"
        >
          <button
            type="button"
            className={`expenses-projections-view-btn${view === 'sales' ? ' is-active' : ''}`}
            aria-pressed={view === 'sales'}
            onClick={() => setView('sales')}
          >
            Sale projection
          </button>
          <button
            type="button"
            className={`expenses-projections-view-btn${view === 'profit' ? ' is-active' : ''}`}
            aria-pressed={view === 'profit'}
            onClick={() => setView('profit')}
          >
            Profit projection
          </button>
          <button
            type="button"
            className={`expenses-projections-view-btn${view === 'listing-goal' ? ' is-active' : ''}`}
            aria-pressed={view === 'listing-goal'}
            onClick={() => setView('listing-goal')}
          >
            Listing goal
          </button>
        </div>

        <div className="expenses-projections-year">
          <label htmlFor="expenses-projections-year-select">Calendar year</label>
          <select
            id="expenses-projections-year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearChoices.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {projError && <div className="stock-error">{projError}</div>}

      {loading && !data && <p className="expenses-projections-loading">Loading projections…</p>}

      {data && view === 'sales' && salesChartData && (
        <>
          <div className="expenses-projections-chart-wrap">
            <Bar data={salesChartData} options={salesChartOptions} />
          </div>

          <div className="expenses-projections-summary">
            <div className="expenses-projections-summary-card">
              <span className="label">Sales YTD</span>
              <span className="value">{formatCurrency(data.summary.salesYtd)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Profit YTD</span>
              <span className="value">{formatCurrency(data.summary.profitYtd)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Items sold YTD</span>
              <span className="value">
                {(data.summary.itemsSoldYtd ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Projected year-end sales</span>
              <span className="value">{formatCurrency(data.summary.projectedYearEndSales)}</span>
            </div>
          </div>

          <div className="expenses-projections-purchases">
            <h3>Sales by month</h3>
            <table className="expenses-projections-week-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Sales</th>
                  <th>Profit</th>
                  <th>Items sold</th>
                  <th>Projected sales</th>
                </tr>
              </thead>
              <tbody>
                {monthlySalesRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.sales != null ? formatCurrency(row.sales) : '—'}</td>
                    <td>{row.profit != null ? formatCurrency(row.profit) : '—'}</td>
                    <td>
                      {row.itemsSold != null ? row.itemsSold.toLocaleString() : '—'}
                    </td>
                    <td>
                      {row.salesProjected != null ? formatCurrency(row.salesProjected) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && view === 'profit' && profitChartData && (
        <>
          <div className="expenses-projections-chart-wrap">
            <Bar data={profitChartData} options={profitChartOptions} />
          </div>

          {profitLineChart ? (
            <div className="expenses-projections-chart-wrap expenses-projections-chart-wrap--listing">
              <Line data={profitLineChart} options={profitLineChartOptions} />
            </div>
          ) : null}

          <div className="expenses-projections-summary">
            <div className="expenses-projections-summary-card">
              <span className="label">Profit YTD</span>
              <span className="value">{formatCurrency(data.summary.profitYtd)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Avg monthly profit</span>
              <span className="value">{formatCurrency(data.summary.avgMonthlyProfit)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Remaining months</span>
              <span className="value">{data.summary.remainingMonths}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Projected year-end profit</span>
              <span className="value">{formatCurrency(data.summary.projectedYearEndProfit)}</span>
            </div>
          </div>

          <div className="expenses-projections-purchases">
            <h3>Profit by month</h3>
            <table className="expenses-projections-week-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Profit</th>
                  <th>Projected profit</th>
                </tr>
              </thead>
              <tbody>
                {monthlySalesRows.map((row) => (
                  <tr key={`profit-${row.label}`}>
                    <td>{row.label}</td>
                    <td>{row.profit != null ? formatCurrency(row.profit) : '—'}</td>
                    <td>
                      {row.profitProjected != null
                        ? formatCurrency(row.profitProjected)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && view === 'listing-goal' && (
        <>
          <div className="expenses-projections-listing-goal">
            <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat">
              <label className="expenses-projections-listing-goal-label" htmlFor="expenses-listing-goal-input">
                Listing Goal
              </label>
              <div className="expenses-projections-purchases-ytd-box expenses-projections-purchases-ytd-box--goal">
                <input
                  id="expenses-listing-goal-input"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="e.g. 5"
                  value={listingGoalPerDay}
                  onChange={(e) => setListingGoalPerDay(e.target.value)}
                  className="expenses-projections-listing-goal-input"
                />
              </div>
              {!listingGoalValid && listingGoalPerDay.trim() !== '' && (
                <p className="expenses-projections-listing-goal-hint expenses-projections-listing-goal-hint--field">
                  Enter a non-negative number.
                </p>
              )}
            </div>
            {listingGoalFrame && (
              <>
                <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat">
                  <span className="expenses-projections-listing-goal-label">{listingGoalFrame.monthLabel}</span>
                  <div className="expenses-projections-purchases-ytd-box">
                    <span className="expenses-projections-purchases-ytd-value">
                      {listingGoalValues
                        ? `${listingGoalValues.monthTotal.toLocaleString()} listings`
                        : '— listings'}
                    </span>
                    <span className="expenses-projections-purchases-ytd-meta">
                      {listingGoalFrame.daysInMonth} days × {listingGoalValues ? listingGoalValues.perDay : '—'}
                    </span>
                  </div>
                </div>
                <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat">
                  <span className="expenses-projections-listing-goal-label">
                    Calendar year {listingGoalFrame.year}
                  </span>
                  <div className="expenses-projections-purchases-ytd-box">
                    <span className="expenses-projections-purchases-ytd-value">
                      {listingGoalValues
                        ? `${listingGoalValues.yearTotal.toLocaleString()} listings`
                        : '— listings'}
                    </span>
                    <span className="expenses-projections-purchases-ytd-meta">
                      {listingGoalFrame.daysInYear} days × {listingGoalValues ? listingGoalValues.perDay : '—'}
                    </span>
                  </div>
                </div>
              </>
            )}
            <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat">
              <span className="expenses-projections-listing-goal-label">Listings YTD</span>
              <div className="expenses-projections-purchases-ytd-box">
                <span className="expenses-projections-purchases-ytd-value">
                  {data.purchasesYearToDate.total.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat">
              <span className="expenses-projections-listing-goal-label">
                Avg weekly
                <br />
                listings
              </span>
              <div className="expenses-projections-purchases-ytd-box">
                <span className="expenses-projections-purchases-ytd-value expenses-projections-avg-weekly-listings-value">
                  <span>{data.purchasesYearToDate.perWeekAverage.toFixed(2)}</span>
                  <span className="expenses-projections-avg-weekly-listings-sep"> / </span>
                  <span>
                    {weeklyListingTargetFromGoal != null
                      ? Number.isInteger(weeklyListingTargetFromGoal)
                        ? weeklyListingTargetFromGoal.toLocaleString()
                        : weeklyListingTargetFromGoal.toFixed(1)
                      : '—'}
                  </span>
                </span>
              </div>
            </div>
            {listingGoalPaceStatus && (
              <div className="expenses-projections-listing-goal-col expenses-projections-listing-goal-col--stat expenses-projections-listing-goal-col--pace">
                <span className="expenses-projections-listing-goal-label">Yearly listing pace</span>
                <div
                  className={`expenses-projections-purchases-ytd-box expenses-projections-purchases-ytd-box--pace expenses-projections-purchases-ytd-box--pace-${listingGoalPaceStatus.tone}`}
                >
                  <span
                    className={`expenses-projections-purchases-ytd-value expenses-projections-pace-headline expenses-projections-pace-headline--${listingGoalPaceStatus.tone}`}
                  >
                    {listingGoalPaceStatus.headline}
                  </span>
                  <span className="expenses-projections-purchases-ytd-meta">{listingGoalPaceStatus.meta}</span>
                </div>
              </div>
            )}
          </div>

          {listingGoalLineChart ? (
            <div className="expenses-projections-chart-wrap expenses-projections-chart-wrap--listing">
              <Line data={listingGoalLineChart} options={listingGoalChartOptions} />
            </div>
          ) : null}

          <div className="expenses-projections-purchases">
            <h3>Listing Targets</h3>

            {purchaseWeekTableRows.length > 0 && (
              <table className="expenses-projections-week-table">
                <thead>
                  <tr>
                    <th>Data commencing</th>
                    <th>Week of year (7-day buckets from 1 Jan)</th>
                    <th>Listing</th>
                    <th>Cumulative listings</th>
                    <th>Cumulative goal target</th>
                    <th>Vs target</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseWeekTableRows.map((row) => (
                    <tr key={row.week}>
                      <td>{row.commencingLabel}</td>
                      <td>Week {row.week}</td>
                      <td>{row.count.toLocaleString()}</td>
                      <td>{row.cumulative.toLocaleString()}</td>
                      <td>{row.cumulativeGoal != null ? row.cumulativeGoal.toLocaleString() : '—'}</td>
                      <td>
                        {row.vsTarget == null ? (
                          '—'
                        ) : row.vsTarget > 0 ? (
                          <span className="expenses-projections-week-table-vs--over">
                            +{row.vsTarget.toLocaleString()}
                          </span>
                        ) : row.vsTarget < 0 ? (
                          <span className="expenses-projections-week-table-vs--under">
                            −{Math.abs(row.vsTarget).toLocaleString()}
                          </span>
                        ) : (
                          <span className="expenses-projections-week-table-vs--even">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
};
