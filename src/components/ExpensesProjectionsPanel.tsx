import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { themeAccentRgba, themePositiveRgba, themeTextRgba } from '../utils/themeColors';
import './Stock.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type Nullable<T> = T | null | undefined;

interface ProjectionsMonthDatum {
  month: number;
  label: string;
  profitActual: number | null;
  salesActual: number | null;
  salesProjected: number | null;
}

interface ProjectionsApiResponse {
  year: number;
  currentMonth: number;
  calendarYear: number;
  months: ProjectionsMonthDatum[];
  summary: {
    profitYtd: number;
    salesYtd: number;
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

function buildProjectionsChartOptions(showRightAxis: boolean): ChartOptions<'bar'> {
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
            const n = Number(raw);
            return `${ctx.dataset.label ?? ''}: ${formatCurrency(n)}`;
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
        position: 'left',
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
          text: 'Net profit (sold lines)',
          color: themeTextRgba(0.55),
          font: { size: 11 },
        },
      },
      y1: showRightAxis
        ? {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
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
              text: 'Projected monthly sales',
              color: themeTextRgba(0.55),
              font: { size: 11 },
            },
          }
        : {
            display: false,
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

export interface ExpensesProjectionsPanelProps {
  labelledBy?: string;
}

export const ExpensesProjectionsPanel: React.FC<ExpensesProjectionsPanelProps> = ({
  labelledBy = 'expenses-tab-projections',
}) => {
  const API_BASE_LOCAL = getApiBase();
  const cy = new Date().getFullYear();
  const [year, setYear] = useState(cy);
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

  const hasProjected = data?.months.some((m) => m.salesProjected != null) ?? false;

  const chartData = useMemo(() => {
    if (!data) {
      return null;
    }
    const profitDataset = {
      label: 'Profit (actual)',
      data: data.months.map((m) => (m.profitActual != null ? m.profitActual : null)),
      backgroundColor: themePositiveRgba(0.55),
      borderColor: themePositiveRgba(0.9),
      borderWidth: 1,
      yAxisID: 'y' as const,
    };
    const projectedDataset = {
      label: 'Projected sales (monthly run rate)',
      data: data.months.map((m) => (m.salesProjected != null ? m.salesProjected : null)),
      backgroundColor: themeAccentRgba(0.42),
      borderColor: themeAccentRgba(0.85),
      borderWidth: 1,
      yAxisID: 'y1' as const,
    };
    return {
      labels: data.months.map((m) => m.label),
      datasets: hasProjected ? [profitDataset, projectedDataset] : [profitDataset],
    };
  }, [data, hasProjected]);

  const chartOptions = useMemo(() => buildProjectionsChartOptions(hasProjected), [hasProjected]);

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
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;
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
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;
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

  return (
    <div className="expenses-projections" role="tabpanel" aria-labelledby={labelledBy}>
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

      {projError && <div className="stock-error">{projError}</div>}

      {loading && !data && <p className="expenses-projections-loading">Loading projections…</p>}

      {data && chartData && (
        <>
          <div className="expenses-projections-chart-wrap">
            <Bar data={chartData} options={chartOptions} />
          </div>

          <div className="expenses-projections-summary">
            <div className="expenses-projections-summary-card">
              <span className="label">Profit YTD</span>
              <span className="value">{formatCurrency(data.summary.profitYtd)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Sales YTD</span>
              <span className="value">{formatCurrency(data.summary.salesYtd)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Projected year-end profit</span>
              <span className="value">{formatCurrency(data.summary.projectedYearEndProfit)}</span>
            </div>
            <div className="expenses-projections-summary-card">
              <span className="label">Projected year-end sales</span>
              <span className="value">{formatCurrency(data.summary.projectedYearEndSales)}</span>
            </div>
          </div>

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
