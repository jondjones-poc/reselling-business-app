import React, { useEffect, useState } from 'react';
import { apiUrl } from '../utils/apiBase';

type WeeklyTopCategory = {
  name: string;
  count: number;
};

type WeeklyCell = {
  weekStart: string;
  weekEnd: string;
  label: string;
  isCurrentWeek: boolean;
  monthLabel?: string | null;
  topCategories: WeeklyTopCategory[];
};

type WeeklyMonth = {
  year: number;
  month: number;
  label: string;
  weeks: WeeklyCell[];
};

type WeeklyPayload = {
  displayLabel: string;
  year: number;
  rangeStart: string;
  rangeEnd: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  weeks: WeeklyCell[];
  months: WeeklyMonth[];
};

type SeasonalYearlyCalendarProps = {
  departmentId: number | null;
};

function friendlyApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not load yearly calendar';
}

function formatWeeklyCategorySoldCount(count: number): string {
  const unit = count === 1 ? 'sale' : 'sales';
  return `${count} ${unit}`;
}

function flattenYearWeeks(payload: WeeklyPayload): WeeklyCell[] {
  if (Array.isArray(payload.weeks) && payload.weeks.length > 0) {
    return payload.weeks;
  }
  const months = Array.isArray(payload.months) ? [...payload.months] : [];
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  const out: WeeklyCell[] = [];
  for (const month of months) {
    const weeks = [...(month.weeks ?? [])].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    weeks.forEach((week, idx) => {
      out.push({
        ...week,
        monthLabel: idx === 0 ? month.label.slice(0, 3) : null,
      });
    });
  }
  return out;
}

const SeasonalYearlyCalendar: React.FC<SeasonalYearlyCalendarProps> = ({ departmentId }) => {
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
  }, [departmentId]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        if (departmentId != null) {
          params.set('department_id', String(departmentId));
        }
        const res = await fetch(
          apiUrl(`/api/stock/seasonal-weekly-top-items?${params.toString()}`),
          { signal: ac.signal }
        );
        const text = await res.text();
        let body: WeeklyPayload & { error?: string; details?: string };
        try {
          body = JSON.parse(text) as WeeklyPayload & { error?: string };
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error(body.error || body.details || res.statusText);
        }
        if (!cancelled) {
          setData({
            displayLabel: body.displayLabel,
            year: Number(body.year) || new Date().getFullYear(),
            rangeStart: body.rangeStart,
            rangeEnd: body.rangeEnd,
            page: Number(body.page) || 0,
            hasPreviousPage: Boolean(body.hasPreviousPage),
            hasNextPage: Boolean(body.hasNextPage),
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
  }, [departmentId, page]);

  const yearWeeks = data ? flattenYearWeeks(data) : [];

  return (
    <section className="research-seasonal-weekly" aria-label="Year calendar by week">
      <header className="research-seasonal-weekly-head">
        <h3 className="research-seasonal-weekly-title">Year calendar</h3>
      </header>

      {loading && !data ? (
        <p className="research-seasonal-weekly-muted">Loading yearly calendar…</p>
      ) : null}

      {error ? (
        <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
          {error}
        </div>
      ) : null}

      {data ? (
        <>
          {loading && yearWeeks.length === 0 ? (
            <p className="research-seasonal-weekly-muted" role="status">
              Loading…
            </p>
          ) : null}

          {yearWeeks.length === 0 && !loading ? (
            <p className="research-seasonal-weekly-empty" role="status">
              No sold items in this date range yet.
            </p>
          ) : null}

          {yearWeeks.length > 0 ? (
            <>
              <div className="research-seasonal-weekly-year-box">
                {yearWeeks.map((week) => (
                  <article
                    key={week.weekStart}
                    className={
                      'research-seasonal-weekly-cell' +
                      (week.isCurrentWeek ? ' research-seasonal-weekly-cell--current' : '') +
                      (week.monthLabel ? ' research-seasonal-weekly-cell--month-start' : '')
                    }
                  >
                    {week.monthLabel ? (
                      <span className="research-seasonal-weekly-month-mark">{week.monthLabel}</span>
                    ) : null}
                    <header className="research-seasonal-weekly-cell-head">
                      <span className="research-seasonal-weekly-cell-label">{week.label}</span>
                      {week.isCurrentWeek ? (
                        <span className="research-seasonal-weekly-cell-badge">Now</span>
                      ) : null}
                    </header>
                    {week.topCategories.length > 0 ? (
                      <ol className="research-seasonal-weekly-items">
                        {week.topCategories.map((row, idx) => (
                          <li key={`${row.name}-${idx}`} className="research-seasonal-weekly-item">
                            <span className="research-seasonal-weekly-item-rank" aria-hidden>
                              {idx + 1}
                            </span>
                            <span className="research-seasonal-weekly-item-label">{row.name}</span>
                            <span className="research-seasonal-weekly-item-count">
                              {formatWeeklyCategorySoldCount(row.count)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="research-seasonal-weekly-empty">—</p>
                    )}
                  </article>
                ))}
              </div>

              <nav className="research-seasonal-weekly-pagination" aria-label="Year calendar pagination">
                <button
                  type="button"
                  className="research-seasonal-weekly-pagination-button"
                  disabled={loading || !data.hasNextPage}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Previous year
                </button>
                <span className="research-seasonal-weekly-pagination-status">
                  {data.displayLabel || String(data.year)}
                </span>
                <button
                  type="button"
                  className="research-seasonal-weekly-pagination-button"
                  disabled={loading || !data.hasPreviousPage}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Next year
                </button>
              </nav>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
};

export default SeasonalYearlyCalendar;
