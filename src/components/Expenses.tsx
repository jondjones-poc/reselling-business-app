import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
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
import './Stock.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const API_BASE = getApiBase();

type Nullable<T> = T | null | undefined;

interface ExpenseRow {
  id: number;
  item: Nullable<string>;
  cost: Nullable<string | number>;
  purchase_date: Nullable<string>;
  receipt_name: Nullable<string>;
  purchase_location: Nullable<string>;
}

interface ExpensesApiResponse {
  rows: ExpenseRow[];
  count: number;
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
    minimumFractionDigits: 2
  }).format(parsed);
};

const formatDate = (value: Nullable<string>) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

const normalizeDateInput = (value: Nullable<string>) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const iso = date.toISOString();
  return iso.slice(0, 10);
};

const stringToDate = (value: Nullable<string>) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateToIsoString = (value: Date | null) => {
  if (!value) {
    return '';
  }
  const iso = value.toISOString();
  return iso.slice(0, 10);
};

type ExpensesMainTab = 'expenses' | 'projections';

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

function buildProjectionsChartOptions(showRightAxis: boolean): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: 'rgba(255, 248, 226, 0.85)',
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
        grid: { color: 'rgba(255, 214, 91, 0.08)' },
        ticks: { color: 'rgba(255, 248, 226, 0.8)' },
      },
      y: {
        position: 'left',
        beginAtZero: true,
        grid: { color: 'rgba(255, 214, 91, 0.12)' },
        ticks: {
          color: 'rgba(255, 248, 226, 0.75)',
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
          color: 'rgba(255, 248, 226, 0.55)',
          font: { size: 11 },
        },
      },
      y1: showRightAxis
        ? {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              color: 'rgba(180, 220, 255, 0.75)',
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
              color: 'rgba(180, 220, 255, 0.6)',
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

const ExpensesProjectionsPanel: React.FC = () => {
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
      backgroundColor: 'rgba(140, 255, 195, 0.55)',
      borderColor: 'rgba(140, 255, 195, 0.9)',
      borderWidth: 1,
      yAxisID: 'y' as const,
    };
    const projectedDataset = {
      label: 'Projected sales (monthly run rate)',
      data: data.months.map((m) => (m.salesProjected != null ? m.salesProjected : null)),
      backgroundColor: 'rgba(120, 180, 255, 0.42)',
      borderColor: 'rgba(120, 180, 255, 0.85)',
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

    const cy = data.purchasesYearToDate.year;
    const now = new Date();
    const yearStart = new Date(cy, 0, 1);
    const yearEnd = new Date(cy, 11, 31, 23, 59, 59, 999);
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
      const vsTarget =
        cumulativeGoal != null ? cumulative - cumulativeGoal : null;
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
    <div className="expenses-projections" role="tabpanel" aria-labelledby="expenses-tab-projections">
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

      {loading && !data && <p style={{ color: 'rgba(255, 248, 226, 0.7)' }}>Loading projections…</p>}

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
                      <td>
                        {row.cumulativeGoal != null ? row.cumulativeGoal.toLocaleString() : '—'}
                      </td>
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

const getCurrentTaxYear = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11, where 0 is January
  
  // Tax year runs from April 1 to March 31
  // If we're in Jan, Feb, or Mar, the tax year started the previous year
  // If we're in Apr-Dec, the tax year started this year
  let taxYearStart: Date;
  let taxYearEnd: Date;
  
  if (currentMonth < 3) {
    // Jan, Feb, Mar - tax year started previous year on April 1
    taxYearStart = new Date(currentYear - 1, 3, 1); // April 1 of previous year
    taxYearEnd = new Date(currentYear, 2, 31, 23, 59, 59, 999); // March 31 of current year
  } else {
    // Apr-Dec - tax year started this year on April 1
    taxYearStart = new Date(currentYear, 3, 1); // April 1 of current year
    taxYearEnd = new Date(currentYear + 1, 2, 31, 23, 59, 59, 999); // March 31 of next year
  }
  
  return { start: taxYearStart, end: taxYearEnd };
};

const Expenses: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof Omit<ExpenseRow, 'id'>;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    item: '',
    cost: '',
    purchase_date: '',
    receipt_name: '',
    purchase_location: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const expensesTab: ExpensesMainTab =
    searchParams.get('tab') === 'projections' ? 'projections' : 'expenses';

  const setExpensesTab = (tab: ExpensesMainTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'expenses') {
      next.delete('tab');
    } else {
      next.set('tab', 'projections');
    }
    setSearchParams(next, { replace: true });
  };

  const loadExpenses = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/expenses`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to load expenses data');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data: ExpensesApiResponse = await response.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setEditingRowId(null);
    } catch (err: any) {
      console.error('Expenses load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load expenses data');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, []);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const filteredRows = useMemo(() => {
    if (!rows.length) {
      return [];
    }

    let filtered = rows;

    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter((row) => {
        const itemName = row.item ? row.item.toLowerCase() : '';
        const receiptName = row.receipt_name ? row.receipt_name.toLowerCase() : '';
        const purchaseLocation = row.purchase_location ? row.purchase_location.toLowerCase() : '';
        return itemName.includes(searchLower) || 
               receiptName.includes(searchLower) || 
               purchaseLocation.includes(searchLower);
      });
    }

    return filtered;
  }, [rows, searchTerm]);

  const sortedRows = useMemo(() => {
    if (!sortConfig) {
      return filteredRows;
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    const getComparableValue = (row: ExpenseRow) => {
      const value = row[key];

      if (value === null || value === undefined) {
        return '';
      }

      if (key === 'cost') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
      }

      if (key === 'purchase_date') {
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
      }

      return String(value).toLowerCase();
    };

    return [...filteredRows].sort((a, b) => {
      const aValue = getComparableValue(a);
      const bValue = getComparableValue(b);

      if (aValue === bValue) {
        return 0;
      }

      if (aValue > bValue) {
        return 1 * multiplier;
      }

      return -1 * multiplier;
    });
  }, [filteredRows, sortConfig]);

  const totals = useMemo(() => {
    let totalCost = 0;

    rows.forEach((row) => {
      if (row.cost) {
        const cost = Number(row.cost);
        if (!Number.isNaN(cost)) {
          totalCost += cost;
        }
      }
    });

    return {
      cost: totalCost
    };
  }, [rows]);

  const handleSort = (key: keyof Omit<ExpenseRow, 'id'>) => {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { key, direction: 'desc' };
      }

      return null;
    });
  };

  const resolveSortIndicator = (key: keyof Omit<ExpenseRow, 'id'>) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '⇅';
    }

    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const startEditingRow = (row: ExpenseRow) => {
    if (creating) {
      return;
    }

    setEditingRowId(row.id);
    setCreateForm({
      item: row.item ?? '',
      cost: row.cost ? String(row.cost) : '',
      purchase_date: normalizeDateInput(row.purchase_date ?? ''),
      receipt_name: row.receipt_name ?? '',
      purchase_location: row.purchase_location ?? ''
    });
    setShowNewEntry(true);
    setSuccessMessage(null);
  };

  const resetCreateForm = () => {
    setCreateForm({
      item: '',
      cost: '',
      purchase_date: '',
      receipt_name: '',
      purchase_location: ''
    });
  };

  const handleCreateChange = (key: keyof typeof createForm, value: string) => {
    setCreateForm((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleCreateSubmit = async () => {
    try {
      setCreating(true);
      setError(null);

      const payload = {
        item: createForm.item,
        cost: createForm.cost,
        purchase_date: createForm.purchase_date,
        receipt_name: createForm.receipt_name,
        purchase_location: createForm.purchase_location
      };

      const isEditing = editingRowId !== null;
      const url = isEditing ? `${API_BASE}/api/expenses/${editingRowId}` : `${API_BASE}/api/expenses`;
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = 'Failed to create expense record';
        try {
          const errorBody = await response.json();
          message = errorBody?.details || errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data = await response.json();
      const updatedRow: ExpenseRow | undefined = data?.row;

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      if (isEditing) {
        setRows((prev) =>
          prev.map((row) => (row.id === updatedRow.id ? updatedRow : row))
        );
        setSuccessMessage('Expense record updated successfully.');
      } else {
        setRows((prev) => [updatedRow, ...prev]);
        setSuccessMessage('Expense record created successfully.');
      }

      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setSortConfig(null);
    } catch (err: any) {
      console.error('Expense create error:', err);
      setError(err.message || 'Unable to create expense record');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!editingRowId) return;

    try {
      setDeleting(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/expenses/${editingRowId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        let message = 'Failed to delete expense record';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      setRows((prev) => prev.filter((row) => row.id !== editingRowId));
      setSuccessMessage('Expense record deleted successfully.');
      
      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setShowDeleteConfirm(false);
    } catch (err: any) {
      console.error('Expense delete error:', err);
      setError(err.message || 'Unable to delete expense record');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleTaxYearExport = async () => {
    try {
      setError(null);
      
      const taxYear = getCurrentTaxYear();
      const taxYearStartStr = taxYear.start.toISOString().slice(0, 10);
      const taxYearEndStr = taxYear.end.toISOString().slice(0, 10);
      
      // Filter expenses for the current tax year
      const taxYearExpenses = rows.filter((row) => {
        if (!row.purchase_date) return false;
        const purchaseDate = new Date(row.purchase_date);
        return purchaseDate >= taxYear.start && purchaseDate <= taxYear.end;
      });
      
      // Fetch stock data
      const stockResponse = await fetch(`${API_BASE}/api/stock`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!stockResponse.ok) {
        throw new Error('Failed to fetch stock data');
      }
      
      const stockData = await stockResponse.json();
      const allStockItems = Array.isArray(stockData.rows) ? stockData.rows : [];
      
      // Filter stock items purchased within tax year
      const taxYearStockPurchases = allStockItems.filter((item: any) => {
        if (!item.purchase_date) return false;
        const purchaseDate = new Date(item.purchase_date);
        return purchaseDate >= taxYear.start && purchaseDate <= taxYear.end;
      });
      
      // Filter stock items sold within tax year
      const taxYearStockSales = allStockItems.filter((item: any) => {
        if (!item.sale_date) return false;
        const saleDate = new Date(item.sale_date);
        return saleDate >= taxYear.start && saleDate <= taxYear.end;
      });
      
      // Calculate total expenses
      const totalExpenses = taxYearExpenses.reduce((sum, row) => {
        const cost = row.cost ? Number(row.cost) : 0;
        return sum + (Number.isNaN(cost) ? 0 : cost);
      }, 0);
      
      // Calculate total clothes cost (purchase_price for items purchased in tax year)
      const totalClothesCost = taxYearStockPurchases.reduce((sum: number, item: any) => {
        const price = item.purchase_price ? Number(item.purchase_price) : 0;
        return sum + (Number.isNaN(price) ? 0 : price);
      }, 0);
      
      // Calculate total sales (sale_price for items sold in tax year)
      const totalSales = taxYearStockSales.reduce((sum: number, item: any) => {
        const price = item.sale_price ? Number(item.sale_price) : 0;
        return sum + (Number.isNaN(price) ? 0 : price);
      }, 0);
      
      // Calculate net: sales - (expenses + clothes cost) 
      // This will be negative when costs exceed sales
      const netAmount = totalSales - (totalExpenses + totalClothesCost);
      
      // Create Tax Summary sheet
      const summaryData = [
        ['Tax Year Summary'],
        [''],
        ['Tax Year Period:', `${taxYearStartStr} to ${taxYearEndStr}`],
        [''],
        ['Total Expenses:', formatCurrency(totalExpenses)],
        ['Total Clothes Cost:', formatCurrency(totalClothesCost)],
        ['Total Sales:', formatCurrency(totalSales)],
        [''],
        ['Net Amount (Sales - Expenses - Clothes Cost):', formatCurrency(netAmount)],
        [''],
        ['Number of Expense Records:', taxYearExpenses.length],
        ['Number of Clothes Purchased:', taxYearStockPurchases.length],
        ['Number of Items Sold:', taxYearStockSales.length],
      ];
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      
      // Set column widths for summary sheet
      summarySheet['!cols'] = [
        { wch: 40 },
        { wch: 30 }
      ];
      
      // Right-align the second column (values column)
      const range = XLSX.utils.decode_range(summarySheet['!ref'] || 'A1');
      for (let row = 0; row <= range.e.r; row++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: 1 });
        if (!summarySheet[cellAddress]) continue;
        if (!summarySheet[cellAddress].s) {
          summarySheet[cellAddress].s = {};
        }
        if (!summarySheet[cellAddress].s.alignment) {
          summarySheet[cellAddress].s.alignment = {};
        }
        summarySheet[cellAddress].s.alignment.horizontal = 'right';
      }
      
      // Create Detailed Expenses sheet
      const expensesData = taxYearExpenses.map((row) => ({
        'Item': row.item || '—',
        'Purchase Location': row.purchase_location || '—',
        'Cost (£)': row.cost ? formatCurrency(row.cost) : '—',
        'Purchase Date': row.purchase_date ? formatDate(row.purchase_date) : '—',
        'Receipt Name': row.receipt_name || '—'
      }));
      
      const expensesSheet = XLSX.utils.json_to_sheet(expensesData);
      
      // Set column widths for expenses sheet
      expensesSheet['!cols'] = [
        { wch: 30 }, // Item
        { wch: 25 }, // Purchase Location
        { wch: 12 }, // Cost
        { wch: 15 }, // Purchase Date
        { wch: 25 }  // Receipt Name
      ];
      
      // Create Stock/Clothes sheet
      const stockSheetData = taxYearStockPurchases.map((item: any) => ({
        'Item Name': item.item_name || '—',
        'Category': item.category || '—',
        'Purchase Price (£)': item.purchase_price ? formatCurrency(item.purchase_price) : '—',
        'Purchase Date': item.purchase_date ? formatDate(item.purchase_date) : '—',
        'Sale Date': item.sale_date ? formatDate(item.sale_date) : '—',
        'Sale Price (£)': item.sale_price ? formatCurrency(item.sale_price) : '—',
        'Sold Platform': item.sold_platform || '—'
      }));
      
      const stockSheet = XLSX.utils.json_to_sheet(stockSheetData);
      
      // Set column widths for stock sheet
      stockSheet['!cols'] = [
        { wch: 40 }, // Item Name
        { wch: 20 }, // Category
        { wch: 15 }, // Purchase Price
        { wch: 15 }, // Purchase Date
        { wch: 15 }, // Sale Date
        { wch: 15 }, // Sale Price
        { wch: 15 }  // Sold Platform
      ];
      
      // Create workbook with all sheets
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tax Summary');
      XLSX.utils.book_append_sheet(workbook, expensesSheet, 'Expenses');
      XLSX.utils.book_append_sheet(workbook, stockSheet, 'Clothes Purchased');
      
      // Generate filename with tax year (e.g., 2024-2025 for April 2024 to March 2025)
      const taxYearLabel = `${taxYear.start.getFullYear()}-${taxYear.end.getFullYear()}`;
      const filename = `Tax_Year_Expenses_${taxYearLabel}.xlsx`;
      
      // Write and download
      XLSX.writeFile(workbook, filename);
      
      setSuccessMessage(`Tax year export downloaded successfully: ${filename}`);
    } catch (err: any) {
      console.error('Tax year export error:', err);
      setError(err.message || 'Failed to export tax year data');
    }
  };

  const renderCellContent = (
    row: ExpenseRow,
    key: keyof Omit<ExpenseRow, 'id'>,
    formatter?: (value: Nullable<string | number>) => string,
    isDate?: boolean
  ) => {
    const value = row[key];

    if (formatter) {
      return formatter(value as Nullable<string | number>);
    }

    return value ?? '—';
  };

  return (
    <div className="stock-container">
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      <div className="expenses-tabs" role="tablist" aria-label="Expenses sections">
        <button
          type="button"
          role="tab"
          id="expenses-tab-records"
          aria-selected={expensesTab === 'expenses'}
          className={`expenses-tab${expensesTab === 'expenses' ? ' expenses-tab--active' : ''}`}
          onClick={() => setExpensesTab('expenses')}
        >
          Expenses
        </button>
        <button
          type="button"
          role="tab"
          id="expenses-tab-projections"
          aria-selected={expensesTab === 'projections'}
          className={`expenses-tab${expensesTab === 'projections' ? ' expenses-tab--active' : ''}`}
          onClick={() => setExpensesTab('projections')}
        >
          Projections
        </button>
      </div>

      {expensesTab === 'expenses' && (
        <>
      {showNewEntry && (
        <div className="new-entry-card">
          <div className="new-entry-grid">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
              <label className="new-entry-field">
                <span>Item</span>
                <input
                  type="text"
                  value={createForm.item}
                  onChange={(event) => handleCreateChange('item', event.target.value)}
                  placeholder="e.g. Postage, Packaging"
                />
              </label>
              <label className="new-entry-field">
                <span>Cost (£)</span>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.cost}
                  onChange={(event) => handleCreateChange('cost', event.target.value)}
                  placeholder="e.g. 5.50"
                />
              </label>
              <label className="new-entry-field">
                <span>Purchase Date</span>
                <DatePicker
                  selected={stringToDate(createForm.purchase_date)}
                  onChange={(date) =>
                    handleCreateChange('purchase_date', dateToIsoString(date ?? null))
                  }
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select purchase date"
                  className="date-picker-input"
                  calendarClassName="date-picker-calendar"
                  wrapperClassName="date-picker-wrapper"
                />
              </label>
              <label className="new-entry-field">
                <span>Receipt Name</span>
                <input
                  type="text"
                  value={createForm.receipt_name}
                  onChange={(event) => handleCreateChange('receipt_name', event.target.value)}
                  placeholder="e.g. receipt_2024_01_15.pdf"
                />
              </label>
              <label className="new-entry-field">
                <span>Purchase Location</span>
                <input
                  type="text"
                  value={createForm.purchase_location}
                  onChange={(event) => handleCreateChange('purchase_location', event.target.value)}
                  placeholder="e.g. Amazon, eBay, Local Store"
                />
              </label>
            </div>
            <div className="new-entry-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto' }}>
              <button
                type="button"
                className="save-button"
                onClick={handleCreateSubmit}
                disabled={creating || deleting}
              >
                {creating ? 'Saving…' : editingRowId ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                className="cancel-button"
                onClick={() => {
                  if (!creating && !deleting) {
                    setShowNewEntry(false);
                    setEditingRowId(null);
                    resetCreateForm();
                    setShowDeleteConfirm(false);
                  }
                }}
                disabled={creating || deleting}
              >
                Close
              </button>
            </div>
            {editingRowId && (
              <div style={{ width: '100%', marginTop: '20px' }}>
                <button
                  type="button"
                  className="delete-button"
                  onClick={handleDeleteClick}
                  disabled={creating || deleting}
                >
                  Delete Item
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={handleDeleteCancel}
        >
          <div 
            className="new-entry-card"
            style={{
              maxWidth: '500px',
              width: '90%',
              margin: '0 auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 20px 0', color: 'var(--neon-primary-strong)', letterSpacing: '0.08rem' }}>
              Confirm Delete
            </h2>
            <p style={{ color: 'rgba(255, 248, 226, 0.85)', marginBottom: '24px', fontSize: '1rem' }}>
              Are you sure you want to delete this expense? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cancel-button"
                onClick={handleDeleteCancel}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="filter-group search-group">
          <div className="search-input-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
            <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
              <input
                type="text"
                className="search-input"
                placeholder="Search expenses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box' }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'rgba(255, 120, 120, 0.15)',
                    border: '1px solid rgba(255, 120, 120, 0.3)',
                    borderRadius: '50%',
                    color: '#ffb0b0',
                    cursor: 'pointer',
                    padding: '0',
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    transition: 'all 0.2s ease',
                    lineHeight: '1'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 120, 120, 0.3)';
                    e.currentTarget.style.boxShadow = '0 0 8px rgba(255, 120, 120, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 120, 120, 0.15)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="filter-group filter-actions">
          <button
            type="button"
            className="new-entry-button"
            onClick={handleTaxYearExport}
            disabled={loading || rows.length === 0}
            style={{ marginRight: '12px' }}
          >
            Download Tax Year Spreadsheet
          </button>
          <button
            type="button"
            className="new-entry-button"
            onClick={() => {
              setShowNewEntry(true);
              setEditingRowId(null);
              resetCreateForm();
              setSuccessMessage(null);
            }}
            disabled={showNewEntry || creating}
          >
            + Add
          </button>
        </div>
      </div>

      <section className="stock-summary">
        <div className="summary-card">
          <span className="summary-label">Total Expenses</span>
          <span className="summary-value">{formatCurrency(totals.cost)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Records</span>
          <span className="summary-value">{sortedRows.length.toLocaleString()}</span>
        </div>
      </section>

      <div className="table-wrapper">
        <table className="stock-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'item' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('item')}
                >
                  Item <span className="sort-indicator">{resolveSortIndicator('item')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_location' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_location')}
                >
                  Purchase Location <span className="sort-indicator">{resolveSortIndicator('purchase_location')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'cost' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('cost')}
                >
                  Cost <span className="sort-indicator">{resolveSortIndicator('cost')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_date' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_date')}
                >
                  Purchase Date <span className="sort-indicator">{resolveSortIndicator('purchase_date')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'receipt_name' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('receipt_name')}
                >
                  Receipt Name <span className="sort-indicator">{resolveSortIndicator('receipt_name')}</span>
                </button>
              </th>
              <th className="stock-table-actions-header">Edit</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No expense records found.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => (
              <tr key={row.id}>
                <td>{renderCellContent(row, 'item')}</td>
                <td>{renderCellContent(row, 'purchase_location')}</td>
                <td>{renderCellContent(row, 'cost', formatCurrency)}</td>
                <td>
                  {renderCellContent(
                    row,
                    'purchase_date',
                    (val) => formatDate(val as Nullable<string>),
                    true
                  )}
                </td>
                <td>{renderCellContent(row, 'receipt_name')}</td>
                <td className="stock-table-actions-cell">
                  <div className="row-actions">
                    <button
                      type="button"
                      className="row-hint-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditingRow(row);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </>
      )}
      {expensesTab === 'projections' && <ExpensesProjectionsPanel />}
    </div>
  );
};

export default Expenses;

