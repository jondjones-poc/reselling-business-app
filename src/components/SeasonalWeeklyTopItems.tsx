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

type SeasonalWeeklyTopItemsProps = {
  departmentId: number | null;
};

const SeasonalWeeklyTopItems: React.FC<SeasonalWeeklyTopItemsProps> = ({ departmentId }) => {
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (departmentId != null) {
          params.set('department_id', String(departmentId));
        }
        const q = params.toString();
        const res = await fetch(
          apiUrl(`/api/stock/seasonal-weekly-top-items${q ? `?${q}` : ''}`),
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
  }, [departmentId]);

  if (loading) {
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

      {data.months.length === 0 ? (
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
    </section>
  );
};

export default SeasonalWeeklyTopItems;
