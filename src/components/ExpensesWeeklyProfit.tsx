import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../utils/apiBase';

type WeeklyProfitCell = {
  weekStart: string;
  weekEnd: string;
  label: string;
  isCurrentWeek: boolean;
  monthLabel?: string | null;
  saleCount: number;
  purchaseCount: number;
  saleTotal: number;
  spendTotal: number;
  spendPerSale: number | null;
  profit: number;
  hasActivity: boolean;
};

type MonthlyProfitRow = {
  month: number;
  label: string;
  saleCount: number;
  purchaseCount: number;
  saleTotal: number;
  spendTotal: number;
  profit: number;
  hasActivity: boolean;
};

type WeeklyProfitPayload = {
  year: number;
  years: number[];
  maxProfit: number;
  maxLoss: number;
  weeks: WeeklyProfitCell[];
  months: MonthlyProfitRow[];
};

type WeekStockItem = {
  id: number;
  item_name: string | null;
  purchase_price: number | string | null;
  purchase_date: string | null;
  sale_date: string | null;
  sale_price: number | string | null;
  brand_name: string;
  category_name: string;
};

function friendlyApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not load weekly profit calendar';
}

function formatGbp(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function heatClassForProfit(
  profit: number,
  hasActivity: boolean,
  maxProfit: number,
  maxLoss: number
): string {
  if (!hasActivity) return 'expenses-profit-week-cell--empty';
  if (profit < 0) {
    const intensity = Math.min(1, Math.abs(profit) / Math.max(maxLoss, 1));
    if (intensity >= 0.66) return 'expenses-profit-week-cell--loss-3';
    if (intensity >= 0.33) return 'expenses-profit-week-cell--loss-2';
    return 'expenses-profit-week-cell--loss-1';
  }
  if (profit === 0) return 'expenses-profit-week-cell--flat';
  const intensity = Math.min(1, profit / Math.max(maxProfit, 1));
  if (intensity >= 0.75) return 'expenses-profit-week-cell--profit-4';
  if (intensity >= 0.5) return 'expenses-profit-week-cell--profit-3';
  if (intensity >= 0.25) return 'expenses-profit-week-cell--profit-2';
  return 'expenses-profit-week-cell--profit-1';
}

const ExpensesWeeklyProfit: React.FC = () => {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [data, setData] = useState<WeeklyProfitPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedWeek, setSelectedWeek] = useState<WeeklyProfitCell | null>(null);
  const [weekItems, setWeekItems] = useState<WeekStockItem[]>([]);
  const [weekItemsLoading, setWeekItemsLoading] = useState(false);
  const [weekItemsError, setWeekItemsError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedWeek(null);
  }, [year]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/api/expenses/weekly-profit?year=${year}`), {
          signal: ac.signal,
        });
        const text = await res.text();
        let body: WeeklyProfitPayload & { error?: string; details?: string };
        try {
          body = JSON.parse(text) as WeeklyProfitPayload & { error?: string };
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error(body.error || body.details || res.statusText);
        }
        if (!cancelled) {
          const years = Array.isArray(body.years) ? body.years : [year];
          setData({
            year: Number(body.year) || year,
            years,
            maxProfit: Number(body.maxProfit) || 1,
            maxLoss: Number(body.maxLoss) || 1,
            weeks: Array.isArray(body.weeks) ? body.weeks : [],
            months: Array.isArray(body.months) ? body.months : [],
          });
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setData(null);
        setError(friendlyApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [year]);

  useEffect(() => {
    if (!selectedWeek) {
      setWeekItems([]);
      setWeekItemsError(null);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;

    const load = async () => {
      setWeekItemsLoading(true);
      setWeekItemsError(null);
      try {
        const qs = new URLSearchParams({
          weekStart: selectedWeek.weekStart,
          weekEnd: selectedWeek.weekEnd,
        });
        const res = await fetch(apiUrl(`/api/expenses/weekly-profit/items?${qs}`), {
          signal: ac.signal,
        });
        const text = await res.text();
        let body: { rows?: WeekStockItem[]; error?: string; details?: string };
        try {
          body = JSON.parse(text) as { rows?: WeekStockItem[]; error?: string };
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error(body.error || body.details || res.statusText);
        }
        if (!cancelled) {
          setWeekItems(Array.isArray(body.rows) ? body.rows : []);
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setWeekItems([]);
        setWeekItemsError(friendlyApiError(e));
      } finally {
        if (!cancelled) setWeekItemsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [selectedWeek]);

  const yearOptions = useMemo(() => {
    if (data?.years?.length) return data.years;
    return [year];
  }, [data, year]);

  const totals = useMemo(() => {
    const empty = { sales: 0, spend: 0, profit: 0, salesCount: 0 };
    if (data?.months?.length) {
      return data.months.reduce(
        (acc, m) => {
          acc.sales += Number(m.saleTotal) || 0;
          acc.spend += Number(m.spendTotal) || 0;
          acc.profit += Number(m.profit) || 0;
          acc.salesCount += Number(m.saleCount) || 0;
          return acc;
        },
        { ...empty }
      );
    }
    if (!data?.weeks?.length) return empty;
    return data.weeks.reduce(
      (acc, w) => {
        acc.sales += Number(w.saleTotal) || 0;
        acc.spend += Number(w.spendTotal) || 0;
        acc.profit += Number(w.profit) || 0;
        acc.salesCount += Number(w.saleCount) || 0;
        return acc;
      },
      { ...empty }
    );
  }, [data]);

  /** Mirrors the week cell's own definition: sales = sale_date in week, spend = purchase_date in week. */
  const weekItemRowFlags = useMemo(() => {
    const weekStart = selectedWeek?.weekStart ?? '';
    const weekEnd = selectedWeek?.weekEnd ?? '';
    const inWeek = (dateStr: string | null) => Boolean(dateStr && dateStr >= weekStart && dateStr <= weekEnd);
    return weekItems.map((item) => {
      const boughtThisWeek = inWeek(item.purchase_date);
      const soldThisWeek = inWeek(item.sale_date);
      const purchasePrice = Number(item.purchase_price) || 0;
      const salePrice = Number(item.sale_price) || 0;
      return {
        item,
        boughtThisWeek,
        soldThisWeek,
        rowProfit: (soldThisWeek ? salePrice : 0) - (boughtThisWeek ? purchasePrice : 0),
      };
    });
  }, [weekItems, selectedWeek]);

  const weekItemsTotals = useMemo(() => {
    return weekItemRowFlags.reduce(
      (acc, row) => {
        if (row.boughtThisWeek) acc.purchase += Number(row.item.purchase_price) || 0;
        if (row.soldThisWeek) acc.sold += Number(row.item.sale_price) || 0;
        acc.profit += row.rowProfit;
        return acc;
      },
      { purchase: 0, sold: 0, profit: 0 }
    );
  }, [weekItemRowFlags]);

  return (
    <section className="expenses-profit-calendar" aria-label="Profit per month week calendar">
      <header className="expenses-profit-calendar-head">
        <div className="expenses-profit-calendar-titles" />
        <label className="expenses-profit-year">
          <span>Year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={loading}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </header>

      {data ? (
        <dl className="expenses-profit-summary" aria-label={`${year} totals`}>
          <div>
            <dt>Year sales</dt>
            <dd>{formatGbp(totals.sales)}</dd>
          </div>
          <div>
            <dt>Year spend</dt>
            <dd>{formatGbp(totals.spend)}</dd>
          </div>
          <div>
            <dt>Year cashflow</dt>
            <dd className={totals.profit < 0 ? 'is-loss' : 'is-profit'}>{formatGbp(totals.profit)}</dd>
          </div>
        </dl>
      ) : null}

      {loading && !data ? <p className="expenses-profit-muted">Loading weekly profit…</p> : null}
      {error ? (
        <div className="stock-error" role="alert">
          {error}
        </div>
      ) : null}

      {data && data.weeks.length > 0 ? (
        <div className="expenses-profit-year-box">
          {data.weeks.map((week) => (
            <article
              key={week.weekStart}
              className={
                'expenses-profit-week-cell' +
                (week.isCurrentWeek ? ' expenses-profit-week-cell--current' : '') +
                (week.monthLabel ? ' expenses-profit-week-cell--month-start' : '') +
                (selectedWeek?.weekStart === week.weekStart ? ' expenses-profit-week-cell--selected' : '') +
                ' expenses-profit-week-cell--clickable' +
                ` ${heatClassForProfit(
                  week.profit,
                  week.hasActivity,
                  data.maxProfit,
                  data.maxLoss
                )}`
              }
              role="button"
              tabIndex={0}
              aria-pressed={selectedWeek?.weekStart === week.weekStart}
              onClick={() =>
                setSelectedWeek((prev) => (prev?.weekStart === week.weekStart ? null : week))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedWeek((prev) => (prev?.weekStart === week.weekStart ? null : week));
                }
              }}
            >
              {week.monthLabel ? (
                <span className="expenses-profit-month-mark">{week.monthLabel}</span>
              ) : null}
              <header className="expenses-profit-week-head">
                <span className="expenses-profit-week-label">{week.label}</span>
                {week.isCurrentWeek ? <span className="expenses-profit-week-badge">Now</span> : null}
              </header>
              {week.hasActivity ? (
                <div className="expenses-profit-week-body">
                  <span className="expenses-profit-week-main">{formatGbp(week.profit)}</span>
                  <span className="expenses-profit-week-sub">
                    {formatGbp(week.saleTotal)} sales
                  </span>
                  <span className="expenses-profit-week-meta">
                    {formatGbp(week.spendTotal)} spent
                    {week.saleCount > 0 ? ` · ${week.saleCount} sold` : ''}
                    {week.purchaseCount > 0 ? ` · ${week.purchaseCount} bought` : ''}
                  </span>
                </div>
              ) : (
                <p className="expenses-profit-week-empty">—</p>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {data && data.months.length > 0 && !selectedWeek ? (
        <div className="expenses-profit-months" aria-label={`${year} monthly cashflow`}>
          <table className="expenses-profit-months-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="expenses-profit-months-num">
                  Sales
                </th>
                <th scope="col" className="expenses-profit-months-num">
                  Spend
                </th>
                <th scope="col" className="expenses-profit-months-num">
                  Cashflow
                </th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((month) => (
                <tr
                  key={month.month}
                  className={
                    month.hasActivity
                      ? month.profit < 0
                        ? 'expenses-profit-months-row--loss'
                        : month.profit > 0
                          ? 'expenses-profit-months-row--profit'
                          : undefined
                      : 'expenses-profit-months-row--empty'
                  }
                >
                  <th scope="row">{month.label}</th>
                  <td className="expenses-profit-months-num">{formatGbp(month.saleTotal)}</td>
                  <td className="expenses-profit-months-num">{formatGbp(month.spendTotal)}</td>
                  <td
                    className={
                      'expenses-profit-months-num expenses-profit-months-total' +
                      (month.profit < 0 ? ' is-loss' : month.profit > 0 ? ' is-profit' : '')
                    }
                  >
                    {formatGbp(month.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Year total</th>
                <td className="expenses-profit-months-num">{formatGbp(totals.sales)}</td>
                <td className="expenses-profit-months-num">{formatGbp(totals.spend)}</td>
                <td
                  className={
                    'expenses-profit-months-num expenses-profit-months-total' +
                    (totals.profit < 0 ? ' is-loss' : totals.profit > 0 ? ' is-profit' : '')
                  }
                >
                  {formatGbp(totals.profit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {data && !loading && data.weeks.every((w) => !w.hasActivity) ? (
        <p className="expenses-profit-muted" role="status">
          No purchases or sales recorded for {year}.
        </p>
      ) : null}

      {selectedWeek ? (
        <section className="expenses-profit-week-items" aria-label={`Items bought or sold in ${selectedWeek.label}`}>
          <header className="expenses-profit-week-items-header">
            <h3>{selectedWeek.label} — items bought or sold</h3>
            <button
              type="button"
              className="expenses-profit-week-items-close"
              onClick={() => setSelectedWeek(null)}
            >
              Close
            </button>
          </header>
          {weekItemsLoading ? <p className="expenses-profit-muted">Loading items…</p> : null}
          {weekItemsError ? (
            <div className="stock-error" role="alert">
              {weekItemsError}
            </div>
          ) : null}
          {!weekItemsLoading && !weekItemsError ? (
            weekItems.length === 0 ? (
              <p className="expenses-profit-muted">No items bought or sold in this week.</p>
            ) : (
              <div className="expenses-profit-week-items-wrap">
                <table className="expenses-profit-week-items-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Type</th>
                      <th scope="col" className="expenses-profit-months-num">
                        Purchase price
                      </th>
                      <th scope="col" className="expenses-profit-months-num">
                        Sold price
                      </th>
                      <th scope="col" className="expenses-profit-months-num">
                        Profit
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekItemRowFlags.map(({ item, boughtThisWeek, soldThisWeek, rowProfit }) => {
                      const isSold = Boolean(item.sale_date);
                      const showProfit = boughtThisWeek || soldThisWeek;
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link
                              to={`/stock?editId=${encodeURIComponent(String(item.id))}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={
                                isSold
                                  ? 'expenses-profit-week-item-name--sold'
                                  : 'expenses-profit-week-item-name--unsold'
                              }
                            >
                              {item.item_name ?? '—'}
                            </Link>
                          </td>
                          <td>{item.category_name}</td>
                          <td className="expenses-profit-months-num">
                            {boughtThisWeek ? formatGbp(Number(item.purchase_price) || 0, 2) : '—'}
                          </td>
                          <td className="expenses-profit-months-num">
                            {soldThisWeek ? formatGbp(Number(item.sale_price) || 0, 2) : '—'}
                          </td>
                          <td
                            className={
                              'expenses-profit-months-num' +
                              (showProfit ? (rowProfit < 0 ? ' is-loss' : ' is-profit') : '')
                            }
                          >
                            {showProfit ? formatGbp(rowProfit, 2) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td />
                      <td className="expenses-profit-months-num">
                        {formatGbp(weekItemsTotals.purchase, 2)}
                      </td>
                      <td className="expenses-profit-months-num">{formatGbp(weekItemsTotals.sold, 2)}</td>
                      <td
                        className={
                          'expenses-profit-months-num expenses-profit-months-total' +
                          (weekItemsTotals.profit < 0 ? ' is-loss' : ' is-profit')
                        }
                      >
                        {formatGbp(weekItemsTotals.profit, 2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          ) : null}
          {!weekItemsLoading && !weekItemsError && weekItems.length > 0 ? (
            <dl className="expenses-profit-week-items-summary" aria-label={`${selectedWeek.label} weekly profit`}>
              <div>
                <dt>Spent this week</dt>
                <dd>{formatGbp(weekItemsTotals.purchase, 2)}</dd>
              </div>
              <div>
                <dt>Sold this week</dt>
                <dd>{formatGbp(weekItemsTotals.sold, 2)}</dd>
              </div>
              <div>
                <dt>Weekly profit</dt>
                <dd className={weekItemsTotals.profit < 0 ? 'is-loss' : 'is-profit'}>
                  {formatGbp(weekItemsTotals.profit, 2)}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};

export default ExpensesWeeklyProfit;
