import React, { useEffect, useMemo, useState } from 'react';
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

type WeeklyProfitPayload = {
  year: number;
  years: number[];
  maxProfit: number;
  maxLoss: number;
  weeks: WeeklyProfitCell[];
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

  const yearOptions = useMemo(() => {
    if (data?.years?.length) return data.years;
    return [year];
  }, [data, year]);

  const totals = useMemo(() => {
    if (!data?.weeks?.length) return { sales: 0, spend: 0, profit: 0, salesCount: 0 };
    return data.weeks.reduce(
      (acc, w) => {
        acc.sales += Number(w.saleTotal) || 0;
        acc.spend += Number(w.spendTotal) || 0;
        acc.profit += Number(w.profit) || 0;
        acc.salesCount += Number(w.saleCount) || 0;
        return acc;
      },
      { sales: 0, spend: 0, profit: 0, salesCount: 0 }
    );
  }, [data]);

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
                ` ${heatClassForProfit(
                  week.profit,
                  week.hasActivity,
                  data.maxProfit,
                  data.maxLoss
                )}`
              }
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

      {data && !loading && data.weeks.every((w) => !w.hasActivity) ? (
        <p className="expenses-profit-muted" role="status">
          No purchases or sales recorded for {year}.
        </p>
      ) : null}
    </section>
  );
};

export default ExpensesWeeklyProfit;
