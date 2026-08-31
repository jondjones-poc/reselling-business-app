import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../utils/apiBase';

type TrendDirection = 'up' | 'down' | 'flat';

type BrandPerformanceRow = {
  brandId: number;
  brandName: string;
  itemsListed: number;
  itemsSold: number;
  unsoldCount: number;
  sellThroughRate: number;
  revenue: number;
  netProfit: number;
  avgNetProfit: number;
  capitalTiedUp: number;
};

type BrandTrendingRow = {
  brandId: number;
  brandName: string;
  soldCount: number;
  saleTotal: number;
  netProfit: number;
  priorSoldCount: number;
  direction: TrendDirection;
};

type BrandTrendingPayload = {
  months: number;
  lookbackMonths: number;
  minItems: number;
  topBuy: BrandPerformanceRow[];
  topAvoid: BrandPerformanceRow[];
  trending: BrandTrendingRow[];
};

type BrandTrendingOverviewProps = {
  departmentId: number | null;
  /** Opens the brand's detail view in the existing Sales by Brand sub-tab. */
  onSelectBrand?: (brandId: number) => void;
};

function friendlyApiError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Could not load brand trends';
}

function formatGbp(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function trendDirectionLabel(direction: TrendDirection): string {
  if (direction === 'up') return 'Rising';
  if (direction === 'down') return 'Cooling';
  return 'Steady';
}

function monthsLabel(months: number): string {
  return months === 1 ? 'month' : `${months} months`;
}

const BrandTrendingOverview: React.FC<BrandTrendingOverviewProps> = ({
  departmentId,
  onSelectBrand,
}) => {
  const [data, setData] = useState<BrandTrendingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (departmentId != null) params.set('department_id', String(departmentId));
        const qs = params.toString();
        const res = await fetch(
          apiUrl(`/api/research/brands/trending${qs ? `?${qs}` : ''}`),
          { credentials: 'include', signal: ac.signal }
        );
        const text = await res.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error(text.slice(0, 200) || res.statusText);
        }
        if (!res.ok) {
          throw new Error((parsed as { error?: string }).error || res.statusText);
        }
        if (cancelled) return;
        setData(parsed as BrandTrendingPayload);
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

  const recentLabel = useMemo(
    () => (data ? monthsLabel(data.months) : '2 months'),
    [data]
  );
  const lookbackLabel = useMemo(
    () => (data ? monthsLabel(data.lookbackMonths) : '12 months'),
    [data]
  );

  const renderBrandName = (row: { brandId: number; brandName: string }) =>
    onSelectBrand ? (
      <button
        type="button"
        className="research-brand-trending-link"
        onClick={() => onSelectBrand(row.brandId)}
      >
        {row.brandName}
      </button>
    ) : (
      <>{row.brandName}</>
    );

  const stateNotice = (emptyMessage: string, rows: unknown[]) => {
    if (loading && !data) {
      return <p className="research-seasonal-weekly-muted">Loading brand trends…</p>;
    }
    if (error) {
      return (
        <div className="menswear-categories-error research-seasonal-weekly-error" role="alert">
          {error}
        </div>
      );
    }
    if (data && rows.length === 0) {
      return (
        <p className="research-seasonal-weekly-empty" role="status">
          {emptyMessage}
        </p>
      );
    }
    return null;
  };

  return (
    <div className="research-seasonal-weekly-stack">
      <div className="research-seasonal-insights-split" aria-label="Brand buy, avoid and trending insights">
        <section className="research-seasonal-buy-now" aria-label="Top brands to buy">
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">Top 10 Brands To Buy</h3>
          </header>
          <p className="research-seasonal-buy-now-context">
            <span className="research-seasonal-buy-now-context-label">
              Best sell-through and profit on stock bought in the last {lookbackLabel}
            </span>
          </p>

          {stateNotice(
            `No brand has enough sales in the last ${lookbackLabel} to recommend yet.`,
            data?.topBuy ?? []
          )}

          {data && data.topBuy.length > 0 ? (
            <ol className="research-seasonal-buy-now-list">
              {data.topBuy.map((row, idx) => (
                <li key={row.brandId} className="research-seasonal-buy-now-item">
                  <span className="research-seasonal-buy-now-rank" aria-hidden>
                    {idx + 1}
                  </span>
                  <div className="research-seasonal-buy-now-item-body">
                    <span className="research-seasonal-buy-now-item-name">
                      {renderBrandName(row)}
                      <span className="research-seasonal-trend-pill research-seasonal-trend-pill--up">
                        {row.sellThroughRate}%
                      </span>
                    </span>
                    <span className="research-seasonal-buy-now-item-meta">
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {row.itemsSold}/{row.itemsListed} sold
                      </span>
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {formatGbp(row.netProfit)} profit
                      </span>
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {formatGbp(row.avgNetProfit)} each
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section
          className="research-seasonal-start-buying research-brand-trending-avoid"
          aria-label="Top brands to avoid"
        >
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">Top 10 Brands To Avoid</h3>
          </header>
          <p className="research-seasonal-buy-now-context">
            <span className="research-seasonal-buy-now-context-label">
              Worst sell-through — cash sitting unsold from the last {lookbackLabel}
            </span>
          </p>

          {stateNotice('Nothing is underperforming enough to flag. Nice.', data?.topAvoid ?? [])}

          {data && data.topAvoid.length > 0 ? (
            <ol className="research-seasonal-buy-now-list">
              {data.topAvoid.map((row, idx) => (
                <li key={row.brandId} className="research-seasonal-buy-now-item">
                  <span className="research-seasonal-buy-now-rank" aria-hidden>
                    {idx + 1}
                  </span>
                  <div className="research-seasonal-buy-now-item-body">
                    <span className="research-seasonal-buy-now-item-name">
                      {renderBrandName(row)}
                      <span className="research-seasonal-trend-pill research-seasonal-trend-pill--down">
                        {row.sellThroughRate}%
                      </span>
                    </span>
                    <span className="research-seasonal-buy-now-item-meta">
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {row.unsoldCount} unsold
                      </span>
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {formatGbp(row.capitalTiedUp)} tied up
                      </span>
                      {row.netProfit < 0 ? (
                        <span className="research-seasonal-buy-now-item-meta-part">
                          {formatGbp(row.netProfit)} loss
                        </span>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section className="research-seasonal-trending" aria-label="Brands trending currently">
          <header className="research-seasonal-buy-now-head">
            <h3 className="research-seasonal-buy-now-title">What&apos;s Trending</h3>
          </header>
          <p className="research-seasonal-buy-now-context">
            <span className="research-seasonal-buy-now-context-label">
              Best sales in the last {recentLabel}, vs the {recentLabel} before
            </span>
          </p>

          {stateNotice(`No sales in the last ${recentLabel} yet.`, data?.trending ?? [])}

          {data && data.trending.length > 0 ? (
            <ol className="research-seasonal-buy-now-list">
              {data.trending.map((row, idx) => (
                <li key={row.brandId} className="research-seasonal-buy-now-item">
                  <span className="research-seasonal-buy-now-rank" aria-hidden>
                    {idx + 1}
                  </span>
                  <div className="research-seasonal-buy-now-item-body">
                    <span className="research-seasonal-buy-now-item-name">
                      {renderBrandName(row)}
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
                        {row.soldCount} sold
                      </span>
                      <span className="research-seasonal-buy-now-item-meta-part">
                        {formatGbp(row.saleTotal)}
                      </span>
                      <span className="research-seasonal-buy-now-item-meta-part">
                        was {row.priorSoldCount} prior
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default BrandTrendingOverview;
