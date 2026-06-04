import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../utils/apiBase';
import './BrandResearch.css';
import './ResearchItemViews.css';

type ListingViewRow = {
  stockId: number;
  itemName: string;
  ebayId: string;
  ebayUrl: string;
  brandName: string | null;
  views: number;
};

type ListingViewsResponse = {
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  totalListings: number;
  listingsWithViewData: number;
  best: ListingViewRow[];
  worst: ListingViewRow[];
  emptyMessage?: string;
  error?: string;
  details?: string;
  reconnectUrl?: string;
};

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 240) || res.statusText);
  }
}

function formatPeriodLabel(start: string, end: string, days: number): string {
  if (start && end) return `${start} → ${end} (last ${days} days)`;
  return `Last ${days} days`;
}

const ResearchItemViews: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectUrl, setReconnectUrl] = useState<string | null>(null);
  const [data, setData] = useState<ListingViewsResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReconnectUrl(null);
    try {
      const res = await fetch(apiUrl('/api/ebay/listing-views?days=30&limit=20'));
      const json = await readJsonResponse<ListingViewsResponse & { error?: string; details?: string }>(
        res
      );
      if (!res.ok) {
        setData(null);
        setError(json.error || json.details || 'Unable to load listing views');
        if (json.reconnectUrl) setReconnectUrl(json.reconnectUrl);
        return;
      }
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Unable to load listing views');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel =
    data != null
      ? formatPeriodLabel(data.periodStart, data.periodEnd, data.periodDays)
      : 'Last 30 days';

  const renderTable = (rows: ListingViewRow[], variant: 'best' | 'worst') => {
    if (rows.length === 0) {
      return (
        <p className="item-views-empty">
          {data?.emptyMessage || 'No listings to show for this period.'}
        </p>
      );
    }
    return (
      <div className="item-views-table-wrap">
        <table className="item-views-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Brand</th>
              <th scope="col" className="item-views-th-views">
                Views
              </th>
              <th scope="col" className="item-views-th-link">
                Listing
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${variant}-${row.stockId}-${row.ebayId}`}>
                <td>
                  <Link to={`/stock?editId=${row.stockId}`} className="item-views-stock-link">
                    {row.itemName?.trim() || `Stock #${row.stockId}`}
                  </Link>
                </td>
                <td>{row.brandName?.trim() || '—'}</td>
                <td className="item-views-td-views">{row.views.toLocaleString()}</td>
                <td>
                  <a
                    href={row.ebayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="item-views-ebay-link"
                  >
                    {row.ebayId}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div
      id="research-panel-item-views"
      role="tabpanel"
      aria-labelledby="research-tab-item-views"
      className="research-tab-panel item-views-page"
    >
      <div className="item-views-toolbar">
        <p className="item-views-period">{periodLabel}</p>
        <button type="button" className="item-views-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <p className="item-views-hint">
        Active eBay listings in stock only (published item ID, not drafts). Views from eBay Sell Analytics.
      </p>

      {error && (
        <div className="menswear-categories-error" role="alert">
          {error}
          {reconnectUrl ? (
            <>
              {' '}
              <Link to={reconnectUrl}>Connect eBay seller</Link>
              {' — if you connected before, reconnect once to grant Analytics access.'}
            </>
          ) : null}
        </div>
      )}

      {loading && !data && !error && (
        <p className="menswear-categories-muted">Loading listing views…</p>
      )}

      {data && !error && (
        <>
          <p className="item-views-meta">
            {data.totalListings.toLocaleString()} active listing
            {data.totalListings === 1 ? '' : 's'}
            {data.listingsWithViewData > 0
              ? ` · ${data.listingsWithViewData.toLocaleString()} with at least 1 view`
              : ''}
          </p>

          <div className="item-views-columns">
            <section className="item-views-section" aria-labelledby="item-views-best-heading">
              <h2 id="item-views-best-heading" className="item-views-section-title">
                Best views
              </h2>
              {renderTable(data.best, 'best')}
            </section>

            <section className="item-views-section" aria-labelledby="item-views-worst-heading">
              <h2 id="item-views-worst-heading" className="item-views-section-title">
                Worst views
              </h2>
              {renderTable(data.worst, 'worst')}
            </section>
          </div>
        </>
      )}
    </div>
  );
};

export default ResearchItemViews;
