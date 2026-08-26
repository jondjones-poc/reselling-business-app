import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../utils/apiBase';

type BuyNowRecommendation = {
  name: string;
  soldCount: number;
  saleTotal: number;
  unsoldInStock: number;
};

type TrendingRow = {
  name: string;
  soldCount: number;
  saleTotal: number;
  priorSoldCount: number;
  direction: 'up' | 'down' | 'flat';
};

type BuyNowPayload = {
  recommendations: BuyNowRecommendation[];
  trending: TrendingRow[];
  startBuying: BuyNowRecommendation[];
  startBuyingMonthLabel: string;
};

type BimesterCategory = {
  name: string;
  count: number;
  saleTotal: number;
};

type BimesterPeriod = {
  index: number;
  label: string;
  periodLabel: string;
  isCurrent: boolean;
  dataYear?: number;
  usedPriorYear?: boolean;
  topCategories: BimesterCategory[];
};

type YearlyBimesterPayload = {
  year: number;
  displayLabel: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  bimesters: BimesterPeriod[];
};

function friendlyApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not load buy tips';
}

function formatGbp(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSoldCount(count: number): string {
  return `${count} ${count === 1 ? 'sale' : 'sales'}`;
}

function trendDirectionLabel(direction: TrendingRow['direction']): string {
  if (direction === 'up') return 'Rising';
  if (direction === 'down') return 'Cooling';
  return 'Steady';
}

type BangerRow = {
  name: string;
  appearances: number;
  totalSold: number;
  saleTotal: number;
};

function aggregateCategoriesFromBimesters(bimesters: BimesterPeriod[]): BangerRow[] {
  const byName = new Map<string, BangerRow>();
  for (const period of bimesters) {
    for (const row of period.topCategories ?? []) {
      const name = String(row.name ?? '').trim();
      if (!name) continue;
      const prev = byName.get(name) ?? {
        name,
        appearances: 0,
        totalSold: 0,
        saleTotal: 0,
      };
      prev.appearances += 1;
      prev.totalSold += Number(row.count) || 0;
      prev.saleTotal += Number(row.saleTotal) || 0;
      byName.set(name, prev);
    }
  }
  return Array.from(byName.values());
}

function buildAllYearRoundBangers(bimesters: BimesterPeriod[]): BangerRow[] {
  return aggregateCategoriesFromBimesters(bimesters)
    .sort((a, b) => {
      if (b.appearances !== a.appearances) return b.appearances - a.appearances;
      if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
      if (b.saleTotal !== a.saleTotal) return b.saleTotal - a.saleTotal;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);
}

function buildTotalSalesBangers(bimesters: BimesterPeriod[]): BangerRow[] {
  return aggregateCategoriesFromBimesters(bimesters)
    .sort((a, b) => {
      if (b.saleTotal !== a.saleTotal) return b.saleTotal - a.saleTotal;
      if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
      if (b.appearances !== a.appearances) return b.appearances - a.appearances;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);
}

type BestBangerRow = BangerRow & {
  score: number;
  avgSale: number;
};

/**
 * Best Banger from the two shortlists only.
 * Score blends year-round appearances, £ sales, and avg sale/item
 * (ASP used as the profitability signal — cost/profit is not in these sections).
 */
function pickBestBanger(
  allYearRound: BangerRow[],
  totalSales: BangerRow[]
): BestBangerRow | null {
  const byName = new Map<string, BangerRow>();
  for (const row of allYearRound) byName.set(row.name, row);
  for (const row of totalSales) byName.set(row.name, row);
  const candidates = Array.from(byName.values());
  if (candidates.length === 0) return null;

  const maxSale = Math.max(...candidates.map((c) => c.saleTotal), 1);
  const avgs = candidates.map((c) => (c.totalSold > 0 ? c.saleTotal / c.totalSold : 0));
  const maxAvg = Math.max(...avgs, 1);

  const inAllYear = new Set(allYearRound.map((r) => r.name));
  const inTotalSales = new Set(totalSales.map((r) => r.name));

  const scored: BestBangerRow[] = candidates.map((c) => {
    const avgSale = c.totalSold > 0 ? c.saleTotal / c.totalSold : 0;
    const periodScore = c.appearances / 6;
    const salesScore = c.saleTotal / maxSale;
    const valueScore = avgSale / maxAvg;
    // Bonus if it lands in both shortlists.
    const bothListsBonus = inAllYear.has(c.name) && inTotalSales.has(c.name) ? 0.08 : 0;
    const score =
      0.38 * periodScore + 0.38 * salesScore + 0.24 * valueScore + bothListsBonus;
    return { ...c, score, avgSale };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.saleTotal !== a.saleTotal) return b.saleTotal - a.saleTotal;
    if (b.appearances !== a.appearances) return b.appearances - a.appearances;
    return a.name.localeCompare(b.name);
  });

  return scored[0] ?? null;
}

type SeasonalWeeklyTopItemsProps = {
  departmentId: number | null;
};

const SeasonalWeeklyTopItems: React.FC<SeasonalWeeklyTopItemsProps> = ({ departmentId }) => {
  const [buyNow, setBuyNow] = useState<BuyNowPayload | null>(null);
  const [buyNowLoading, setBuyNowLoading] = useState(true);
  const [buyNowError, setBuyNowError] = useState<string | null>(null);
  const [bimesterData, setBimesterData] = useState<YearlyBimesterPayload | null>(null);
  const [bimesterPage, setBimesterPage] = useState(0);
  const [bimesterLoading, setBimesterLoading] = useState(true);
  const [bimesterError, setBimesterError] = useState<string | null>(null);

  useEffect(() => {
    setBimesterPage(0);
  }, [departmentId]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const loadBuyNow = async () => {
      setBuyNowLoading(true);
      setBuyNowError(null);
      try {
        const params = new URLSearchParams();
        if (departmentId != null) {
          params.set('department_id', String(departmentId));
        }
        const qs = params.toString();
        const res = await fetch(apiUrl(`/api/stock/seasonal-buy-now${qs ? `?${qs}` : ''}`), {
          signal: ac.signal,
        });
        const text = await res.text();
        let body: BuyNowPayload & {
          startBuyingWindow?: { monthLabel?: string };
          error?: string;
          details?: string;
        };
        try {
          body = JSON.parse(text) as typeof body;
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error(body.error || body.details || res.statusText);
        }
        if (!cancelled) {
          const trending: TrendingRow[] = Array.isArray(body.trending)
            ? body.trending.map((row) => {
                const direction =
                  row.direction === 'up' || row.direction === 'down' || row.direction === 'flat'
                    ? row.direction
                    : 'flat';
                return {
                  name: String(row.name ?? 'Uncategorized'),
                  soldCount: Number(row.soldCount) || 0,
                  saleTotal: Number(row.saleTotal) || 0,
                  priorSoldCount: Number(row.priorSoldCount) || 0,
                  direction,
                };
              })
            : [];
          setBuyNow({
            recommendations: Array.isArray(body.recommendations) ? body.recommendations : [],
            trending,
            startBuying: Array.isArray(body.startBuying) ? body.startBuying : [],
            startBuyingMonthLabel: String(
              body.startBuyingWindow?.monthLabel || body.startBuyingMonthLabel || ''
            ),
          });
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setBuyNow(null);
        setBuyNowError(friendlyApiError(e));
      } finally {
        if (!cancelled) setBuyNowLoading(false);
      }
    };

    void loadBuyNow();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [departmentId]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const loadBimesters = async () => {
      setBimesterLoading(true);
      setBimesterError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(bimesterPage));
        if (departmentId != null) {
          params.set('department_id', String(departmentId));
        }
        const res = await fetch(
          apiUrl(`/api/stock/seasonal-yearly-bimesters?${params.toString()}`),
          { signal: ac.signal }
        );
        const text = await res.text();
        let body: YearlyBimesterPayload & { error?: string; details?: string };
        try {
          body = JSON.parse(text) as YearlyBimesterPayload & { error?: string };
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error(body.error || body.details || res.statusText);
        }
        if (!cancelled) {
          setBimesterData({
            year: Number(body.year) || new Date().getFullYear(),
            displayLabel: String(body.displayLabel ?? body.year ?? ''),
            page: Number(body.page) || 0,
            hasPreviousPage: Boolean(body.hasPreviousPage),
            hasNextPage: Boolean(body.hasNextPage),
            bimesters: Array.isArray(body.bimesters) ? body.bimesters : [],
          });
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setBimesterData(null);
        setBimesterError(friendlyApiError(e));
      } finally {
        if (!cancelled) setBimesterLoading(false);
      }
    };

    void loadBimesters();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [departmentId, bimesterPage]);

  const allYearRoundBangers = useMemo(
    () => (bimesterData ? buildAllYearRoundBangers(bimesterData.bimesters) : []),
    [bimesterData]
  );
  const totalSalesBangers = useMemo(
    () => (bimesterData ? buildTotalSalesBangers(bimesterData.bimesters) : []),
    [bimesterData]
  );
  const bestBanger = useMemo(
    () => pickBestBanger(allYearRoundBangers, totalSalesBangers),
    [allYearRoundBangers, totalSalesBangers]
  );

  return (
    <div className="research-seasonal-weekly-stack">
      <div className="research-seasonal-insights-split" aria-label="Buy and trending insights">
        <section className="research-seasonal-buy-now" aria-label="What to buy now">
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">What To Buy</h3>
          </header>

          {buyNowLoading && !buyNow ? (
            <p className="research-seasonal-weekly-muted">Loading buy tips…</p>
          ) : null}

          {buyNowError ? (
            <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
              {buyNowError}
            </div>
          ) : null}

          {buyNow ? (
            buyNow.recommendations.length === 0 ? (
              <p className="research-seasonal-weekly-empty" role="status">
                Not enough sales in the last 4 weeks to recommend buys.
              </p>
            ) : (
              <ol className="research-seasonal-buy-now-list">
                {buyNow.recommendations.map((row, idx) => (
                  <li key={row.name} className="research-seasonal-buy-now-item">
                    <span className="research-seasonal-buy-now-rank" aria-hidden>
                      {idx + 1}
                    </span>
                    <div className="research-seasonal-buy-now-item-body">
                      <span className="research-seasonal-buy-now-item-name">{row.name}</span>
                      <span className="research-seasonal-buy-now-item-meta">
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {row.soldCount} sold
                        </span>
                        {row.saleTotal > 0 ? (
                          <span className="research-seasonal-buy-now-item-meta-part">
                            {formatGbp(row.saleTotal)}
                          </span>
                        ) : null}
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {row.unsoldInStock} in stock
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )
          ) : null}
        </section>

        <section className="research-seasonal-trending" aria-label="What's trending currently">
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">What&apos;s Trending</h3>
          </header>

          {buyNowLoading && !buyNow ? (
            <p className="research-seasonal-weekly-muted">Loading trends…</p>
          ) : null}

          {buyNowError ? (
            <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
              {buyNowError}
            </div>
          ) : null}

          {buyNow ? (
            buyNow.trending.length === 0 ? (
              <p className="research-seasonal-weekly-empty" role="status">
                No recent sales to show trends yet.
              </p>
            ) : (
              <ol className="research-seasonal-buy-now-list">
                {buyNow.trending.map((row, idx) => (
                  <li key={row.name} className="research-seasonal-buy-now-item">
                    <span className="research-seasonal-buy-now-rank" aria-hidden>
                      {idx + 1}
                    </span>
                    <div className="research-seasonal-buy-now-item-body">
                      <span className="research-seasonal-buy-now-item-name">
                        {row.name}
                        <span
                          className={
                            'research-seasonal-trend-pill research-seasonal-trend-pill--' +
                            row.direction
                          }
                        >
                          {trendDirectionLabel(row.direction)}
                        </span>
                      </span>
                      <span className="research-seasonal-buy-now-item-meta">
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {row.soldCount} sold recently
                        </span>
                        {row.saleTotal > 0 ? (
                          <span className="research-seasonal-buy-now-item-meta-part">
                            {formatGbp(row.saleTotal)}
                          </span>
                        ) : null}
                        <span className="research-seasonal-buy-now-item-meta-part">
                          was {row.priorSoldCount} prior
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )
          ) : null}
        </section>

        <section className="research-seasonal-start-buying" aria-label="What to start buying">
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">What To Start Buying</h3>
          </header>

          {buyNowLoading && !buyNow ? (
            <p className="research-seasonal-weekly-muted">Loading forward buys…</p>
          ) : null}

          {buyNowError ? (
            <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
              {buyNowError}
            </div>
          ) : null}

          {buyNow ? (
            buyNow.startBuying.length === 0 ? (
              <p className="research-seasonal-weekly-empty" role="status">
                Not enough last-year sales in the +3–5 month window yet.
              </p>
            ) : (
              <ol className="research-seasonal-buy-now-list">
                {buyNow.startBuying.map((row, idx) => (
                  <li key={row.name} className="research-seasonal-buy-now-item">
                    <span className="research-seasonal-buy-now-rank" aria-hidden>
                      {idx + 1}
                    </span>
                    <div className="research-seasonal-buy-now-item-body">
                      <span className="research-seasonal-buy-now-item-name">{row.name}</span>
                      <span className="research-seasonal-buy-now-item-meta">
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {row.soldCount} sold
                          {buyNow.startBuyingMonthLabel
                            ? ` ${buyNow.startBuyingMonthLabel} last year`
                            : ' in +3–5 mo last year'}
                        </span>
                        {row.saleTotal > 0 ? (
                          <span className="research-seasonal-buy-now-item-meta-part">
                            {formatGbp(row.saleTotal)}
                          </span>
                        ) : null}
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {row.unsoldInStock} in stock
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )
          ) : null}
        </section>
      </div>

      <section className="research-seasonal-yearly" aria-label="Bimester breakdown">
        <header className="research-seasonal-yearly-head">
          <h3 className="research-seasonal-yearly-title">Trends Per Season</h3>
        </header>

        {bimesterLoading && !bimesterData ? (
          <p className="research-seasonal-weekly-muted">Loading bimesters…</p>
        ) : null}

        {bimesterError ? (
          <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
            {bimesterError}
          </div>
        ) : null}

        {bimesterData ? (
          <>
            <div className="research-seasonal-bimester-grid">
              {bimesterData.bimesters.map((period) => (
                <article
                  key={period.index}
                  className={
                    'research-seasonal-bimester' +
                    (period.isCurrent ? ' research-seasonal-bimester--current' : '')
                  }
                >
                  <header className="research-seasonal-bimester-head">
                    <div className="research-seasonal-bimester-titles">
                      <h4 className="research-seasonal-bimester-label">{period.label}</h4>
                      <span className="research-seasonal-bimester-period">
                        {period.periodLabel}
                        {period.dataYear != null ? ` · ${period.dataYear}` : ''}
                      </span>
                    </div>
                    <span
                      className={
                        'research-seasonal-bimester-badge' +
                        (period.isCurrent ? '' : ' research-seasonal-bimester-badge--placeholder')
                      }
                      aria-hidden={!period.isCurrent}
                    >
                      {period.isCurrent ? 'Now' : '\u00a0'}
                    </span>
                  </header>

                  {period.topCategories.length > 0 ? (
                    <ol className="research-seasonal-bimester-list">
                      {period.topCategories.map((row, idx) => (
                        <li
                          key={`${period.index}-${row.name}`}
                          className="research-seasonal-bimester-item"
                        >
                          <div className="research-seasonal-bimester-item-main">
                            <span className="research-seasonal-bimester-rank" aria-hidden>
                              {idx + 1}
                            </span>
                            <span className="research-seasonal-bimester-item-name">{row.name}</span>
                          </div>
                          <span className="research-seasonal-bimester-item-meta">
                            {formatSoldCount(row.count)}
                            {row.saleTotal > 0 ? ` · ${formatGbp(row.saleTotal)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="research-seasonal-weekly-empty" role="status">
                      No sales in this bimester
                    </p>
                  )}
                </article>
              ))}
            </div>

            <section className="research-seasonal-bangers" aria-label="All Year Round Bangers">
              <header className="research-seasonal-yearly-head">
                <h3 className="research-seasonal-yearly-title">All Year Round Bangers</h3>
              </header>
              {allYearRoundBangers.length === 0 ? (
                <p className="research-seasonal-weekly-empty" role="status">
                  Not enough seasonal data yet to pick bangers.
                </p>
              ) : (
                <ol className="research-seasonal-bangers-list">
                  {allYearRoundBangers.map((row, idx) => (
                    <li key={row.name} className="research-seasonal-bangers-item">
                      <span className="research-seasonal-bangers-rank" aria-hidden>
                        {idx + 1}
                      </span>
                      <div className="research-seasonal-bangers-item-body">
                        <span className="research-seasonal-bangers-item-name">{row.name}</span>
                        <span className="research-seasonal-bangers-item-meta">
                          <span className="research-seasonal-buy-now-item-meta-part">
                            in {row.appearances} of 6 periods
                          </span>
                          <span className="research-seasonal-buy-now-item-meta-part">
                            {formatSoldCount(row.totalSold)}
                          </span>
                          {row.saleTotal > 0 ? (
                            <span className="research-seasonal-buy-now-item-meta-part">
                              {formatGbp(row.saleTotal)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section
              className="research-seasonal-bangers research-seasonal-bangers--sales"
              aria-label="Total Sales Banger"
            >
              <header className="research-seasonal-yearly-head">
                <h3 className="research-seasonal-yearly-title">Total Sales Banger</h3>
              </header>
              {totalSalesBangers.length === 0 ? (
                <p className="research-seasonal-weekly-empty" role="status">
                  Not enough seasonal data yet for total sales bangers.
                </p>
              ) : (
                <ol className="research-seasonal-bangers-list">
                  {totalSalesBangers.map((row, idx) => (
                    <li key={row.name} className="research-seasonal-bangers-item">
                      <span className="research-seasonal-bangers-rank" aria-hidden>
                        {idx + 1}
                      </span>
                      <div className="research-seasonal-bangers-item-body">
                        <span className="research-seasonal-bangers-item-name">{row.name}</span>
                        <span className="research-seasonal-bangers-item-meta">
                          {row.saleTotal > 0 ? (
                            <span className="research-seasonal-buy-now-item-meta-part">
                              {formatGbp(row.saleTotal)}
                            </span>
                          ) : null}
                          <span className="research-seasonal-buy-now-item-meta-part">
                            {formatSoldCount(row.totalSold)}
                          </span>
                          <span className="research-seasonal-buy-now-item-meta-part">
                            in {row.appearances} of 6 periods
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="research-seasonal-best-banger" aria-label="Best Banger">
              <header className="research-seasonal-yearly-head">
                <h3 className="research-seasonal-yearly-title">Best Banger</h3>
              </header>
              {!bestBanger ? (
                <p className="research-seasonal-weekly-empty" role="status">
                  Not enough banger data yet to pick a best category.
                </p>
              ) : (
                <div className="research-seasonal-best-banger-card">
                  <span className="research-seasonal-best-banger-crown" aria-hidden>
                    1
                  </span>
                  <div className="research-seasonal-best-banger-body">
                    <span className="research-seasonal-best-banger-name">{bestBanger.name}</span>
                    <span className="research-seasonal-best-banger-meta">
                      <span className="research-seasonal-buy-now-item-meta-part">
                        in {bestBanger.appearances} of 6 periods
                      </span>
                      {bestBanger.saleTotal > 0 ? (
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {formatGbp(bestBanger.saleTotal)} sales
                        </span>
                      ) : null}
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {formatSoldCount(bestBanger.totalSold)}
                      </span>
                      {bestBanger.avgSale > 0 ? (
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {formatGbp(bestBanger.avgSale)} avg
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              )}
            </section>

            <nav
              className="research-seasonal-weekly-pagination"
              aria-label="Bimester year pagination"
            >
              <button
                type="button"
                className="research-seasonal-weekly-pagination-button"
                disabled={bimesterLoading || !bimesterData.hasNextPage}
                onClick={() => setBimesterPage((p) => p + 1)}
              >
                Previous year
              </button>
              <span className="research-seasonal-weekly-pagination-status">
                {bimesterData.displayLabel || String(bimesterData.year)}
              </span>
              <button
                type="button"
                className="research-seasonal-weekly-pagination-button"
                disabled={bimesterLoading || !bimesterData.hasPreviousPage}
                onClick={() => setBimesterPage((p) => Math.max(0, p - 1))}
              >
                Next year
              </button>
            </nav>
          </>
        ) : null}
      </section>
    </div>
  );
};

export default SeasonalWeeklyTopItems;
