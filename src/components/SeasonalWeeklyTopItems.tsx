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
  rangeStart: string;
  rangeEnd: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  months: WeeklyMonth[];
};

function friendlyApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not load weekly top categories';
}

function formatWeeklyCategorySoldCount(count: number): string {
  const unit = count === 1 ? 'pair' : 'pairs';
  return `${count} ${unit}`;
}

function formatWeeklyRangeLabel(rangeStart: string, rangeEnd: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  return `${fmt(rangeStart)} – ${fmt(rangeEnd)}`;
}

type SeasonalWeeklyTopItemsProps = {
  departmentId: number | null;
};

const SeasonalWeeklyTopItems: React.FC<SeasonalWeeklyTopItemsProps> = ({ departmentId }) => {
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
            rangeStart: body.rangeStart,
            rangeEnd: body.rangeEnd,
            page: Number(body.page) || 0,
            hasPreviousPage: Boolean(body.hasPreviousPage),
            hasNextPage: Boolean(body.hasNextPage),
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

  const showPagination =
    data != null && (data.hasNextPage || data.hasPreviousPage || page > 0);

  if (loading && !data) {
    return <p className="research-seasonal-weekly-muted">Loading weekly top categories…</p>;
  }

  if (error) {
    return (
      <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <section className="research-seasonal-weekly" aria-label="Weekly top categories calendar">
      <header className="research-seasonal-weekly-head">
        <h3 className="research-seasonal-weekly-title">Weekly top categories</h3>
      </header>

      {loading && data.months.length === 0 ? (
        <p className="research-seasonal-weekly-muted" role="status">
          Loading…
        </p>
      ) : null}

      {data.months.length === 0 && !loading ? (
        <p className="research-seasonal-weekly-empty" role="status">
          No sold items in this date range yet.
        </p>
      ) : null}

      {data.months.map((month) => (
            <div key={`${month.year}-${month.month}`} className="research-seasonal-weekly-month">
              <h4 className="research-seasonal-weekly-month-title">
                {month.label} {month.year}
              </h4>
              <div className="research-seasonal-weekly-grid">
                {month.weeks.map((week) => (
                  <article
                    key={week.weekStart}
                    className={
                      'research-seasonal-weekly-cell' +
                      (week.isCurrentWeek ? ' research-seasonal-weekly-cell--current' : '')
                    }
                  >
                    <header className="research-seasonal-weekly-cell-head">
                      <span className="research-seasonal-weekly-cell-label">{week.label}</span>
                      {week.isCurrentWeek ? (
                        <span className="research-seasonal-weekly-cell-badge">This week</span>
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
                      <p className="research-seasonal-weekly-empty">No sales this week</p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}

      {showPagination ? (
        <nav
          className="research-seasonal-weekly-pagination"
          aria-label="Weekly top categories date range pagination"
        >
          {data.hasPreviousPage ? (
            <button
              type="button"
              className="research-seasonal-weekly-pagination-button"
              disabled={loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous 6 months
            </button>
          ) : null}
          <span className="research-seasonal-weekly-pagination-status">
            {formatWeeklyRangeLabel(data.rangeStart, data.rangeEnd)}
          </span>
          {data.hasNextPage ? (
            <button
              type="button"
              className="research-seasonal-weekly-pagination-button"
              disabled={loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next 6 months
            </button>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
};

export default SeasonalWeeklyTopItems;
