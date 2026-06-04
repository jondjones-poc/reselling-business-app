import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js';
import { Pie } from 'react-chartjs-2';
import { apiUrl, ebayOAuthStartUrl } from '../utils/apiBase';
import './BrandResearch.css';
import './Orders.css';
import './ResearchItemViews.css';

ChartJS.register(ArcElement, Tooltip, Legend);

/** Compact eBay wordmark — matches Orders page connect button. */
function EbayLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 52 18"
      width={52}
      height={18}
      aria-hidden
      focusable="false"
    >
      <text
        x="0"
        y="14.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.03em"
      >
        <tspan fill="#E53238">e</tspan>
        <tspan fill="#0064D2">b</tspan>
        <tspan fill="#F5AF02">a</tspan>
        <tspan fill="#86B817">y</tspan>
      </text>
    </svg>
  );
}

type ListingViewRow = {
  stockId: number;
  itemName: string;
  ebayId: string;
  ebayUrl: string;
  brandName: string | null;
  categoryName?: string | null;
  views: number;
  imageUrl?: string | null;
  listingTitle?: string | null;
  priceLabel?: string | null;
  listingDate?: string | null;
};

type ListingFeedMode = 'best' | 'worst';

type CategoryViewRow = {
  categoryName: string;
  views: number;
  listingCount: number;
};

type ListingViewsResponse = {
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  totalListings: number;
  listingsWithViewData: number;
  best: ListingViewRow[];
  worst: ListingViewRow[];
  bestCategories?: CategoryViewRow[];
  worstCategories?: CategoryViewRow[];
  emptyMessage?: string;
  error?: string;
  details?: string;
  reconnectUrl?: string;
};

type CategoryPieModel = {
  data: {
    labels: string[];
    datasets: {
      data: number[];
      backgroundColor: string[];
      borderColor: string;
      borderWidth: number;
    }[];
  };
  rows: CategoryViewRow[];
};

const BEST_CATEGORY_PALETTE = [
  'rgba(134, 184, 23, 0.88)',
  'rgba(59, 130, 246, 0.88)',
  'rgba(16, 185, 129, 0.88)',
  'rgba(245, 158, 11, 0.88)',
  'rgba(139, 92, 246, 0.88)',
  'rgba(14, 165, 233, 0.88)',
  'rgba(34, 197, 94, 0.88)',
  'rgba(250, 204, 21, 0.88)',
];

const WORST_CATEGORY_PALETTE = [
  'rgba(239, 68, 68, 0.82)',
  'rgba(244, 114, 182, 0.82)',
  'rgba(251, 146, 60, 0.82)',
  'rgba(168, 85, 247, 0.82)',
  'rgba(248, 113, 113, 0.82)',
  'rgba(217, 119, 6, 0.82)',
  'rgba(190, 24, 93, 0.82)',
  'rgba(220, 38, 38, 0.82)',
];

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 240) || res.statusText);
  }
}

function buildCategoryPieModel(rows: CategoryViewRow[], palette: string[]): CategoryPieModel | null {
  const filtered = rows.filter((r) => r.listingCount > 0);
  if (filtered.length === 0) return null;
  return {
    rows: filtered,
    data: {
      labels: filtered.map((r) => r.categoryName),
      datasets: [
        {
          data: filtered.map((r) => r.views),
          backgroundColor: filtered.map((_, i) => palette[i % palette.length]),
          borderColor: 'rgba(14, 18, 26, 0.9)',
          borderWidth: 1.5,
        },
      ],
    },
  };
}

function buildCategoryPieOptions(rows: CategoryViewRow[]): ChartOptions<'pie'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: 'rgba(255, 248, 226, 0.85)',
          boxWidth: 12,
          boxHeight: 12,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const row = rows[ctx.dataIndex];
            if (!row) return '';
            const views = row.views.toLocaleString();
            const listings = row.listingCount.toLocaleString();
            return `${row.categoryName}: ${views} views (${listings} listing${row.listingCount === 1 ? '' : 's'})`;
          },
        },
      },
    },
  };
}

function formatListingDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ResearchItemViews: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectNeeded, setReconnectNeeded] = useState(false);
  const [oauthFlash, setOauthFlash] = useState<string | null>(null);
  const [data, setData] = useState<ListingViewsResponse | null>(null);
  const [listingFeedMode, setListingFeedMode] = useState<ListingFeedMode>('best');
  const [selectedListing, setSelectedListing] = useState<ListingViewRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReconnectNeeded(false);
    try {
      const res = await fetch(apiUrl('/api/ebay/listing-views?days=30&limit=50&categoryLimit=8'));
      const json = await readJsonResponse<ListingViewsResponse & { error?: string; details?: string }>(
        res
      );
      if (!res.ok) {
        setData(null);
        setError(json.error || json.details || 'Unable to load listing views');
        if (json.reconnectUrl || res.status === 403 || res.status === 503) {
          setReconnectNeeded(true);
        }
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

  useEffect(() => {
    const flag = searchParams.get('ebay_oauth');
    if (!flag) return;
    if (flag === 'success') {
      setOauthFlash('eBay seller linked. Loading listing views…');
      void load();
    } else if (flag === 'error') {
      const msg = searchParams.get('ebay_oauth_msg');
      setOauthFlash(msg ? `eBay connection failed: ${msg}` : 'eBay connection failed.');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('ebay_oauth');
    next.delete('ebay_oauth_msg');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, load]);

  const bestCategoryPie = useMemo(
    () => buildCategoryPieModel(data?.bestCategories ?? [], BEST_CATEGORY_PALETTE),
    [data?.bestCategories]
  );

  const worstCategoryPie = useMemo(
    () => buildCategoryPieModel(data?.worstCategories ?? [], WORST_CATEGORY_PALETTE),
    [data?.worstCategories]
  );

  const bestCategoryPieOptions = useMemo(
    () => buildCategoryPieOptions(bestCategoryPie?.rows ?? []),
    [bestCategoryPie?.rows]
  );

  const worstCategoryPieOptions = useMemo(
    () => buildCategoryPieOptions(worstCategoryPie?.rows ?? []),
    [worstCategoryPie?.rows]
  );

  const activeFeedRows = listingFeedMode === 'best' ? data?.best ?? [] : data?.worst ?? [];

  const closeListingModal = useCallback(() => {
    setSelectedListing(null);
  }, []);

  useEffect(() => {
    if (!selectedListing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeListingModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedListing, closeListingModal]);

  useEffect(() => {
    closeListingModal();
  }, [listingFeedMode, closeListingModal]);

  const renderCategoryPie = (model: CategoryPieModel | null, options: ChartOptions<'pie'>) => {
    if (!model) {
      return <p className="item-views-empty">Not enough category data for a chart.</p>;
    }
    return (
      <div className="item-views-pie-wrap">
        <Pie data={model.data} options={options} />
      </div>
    );
  };

  const renderListingFeed = (rows: ListingViewRow[]) => {
    if (rows.length === 0) {
      return (
        <p className="item-views-empty">
          {data?.emptyMessage || 'No listings to show for this period.'}
        </p>
      );
    }
    return (
      <div className="item-views-feed-grid">
        {rows.map((row) => {
          const label = row.listingTitle?.trim() || row.itemName?.trim() || `Stock #${row.stockId}`;
          return (
            <article key={`${listingFeedMode}-${row.stockId}-${row.ebayId}`} className="item-views-feed-card">
              <button
                type="button"
                className="item-views-feed-card-link"
                title={label}
                onClick={() => setSelectedListing(row)}
              >
                <div className="item-views-feed-card-media">
                  {row.imageUrl ? (
                    <img src={row.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="item-views-feed-card-fallback" aria-hidden="true">
                      {label.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="item-views-feed-card-meta">
                  <span className="item-views-feed-card-views">
                    {row.views.toLocaleString()} view{row.views === 1 ? '' : 's'}
                  </span>
                </div>
              </button>
            </article>
          );
        })}
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
      {oauthFlash && (
        <p className="item-views-oauth-flash" role="status">
          {oauthFlash}
        </p>
      )}

      {error && (
        <div className="item-views-notice" role="alert">
          <p className="item-views-notice-text">{error}</p>
          {reconnectNeeded ? (
            <>
              <p className="item-views-notice-sub">
                For listing views, enable Sell Analytics in the eBay Developer Portal, set{' '}
                <code className="item-views-notice-code">EBAY_OAUTH_INCLUDE_ANALYTICS=1</code> on the
                API server, restart the API, then reconnect once.
              </p>
              <a
                href={ebayOAuthStartUrl('/analytics?tab=item-views')}
                className="orders-vinted-ebay-check-button item-views-connect-ebay"
                title="Connect your eBay seller account"
              >
                <EbayLogoIcon className="orders-unlist-ebay-logo" />
                <span className="orders-unlist-ebay-label">Connect eBay seller</span>
              </a>
            </>
          ) : null}
        </div>
      )}

      {loading && !data && !error && (
        <p className="menswear-categories-muted">Loading listing views…</p>
      )}

      {data && !error && (
        <>
          <div className="item-views-columns">
            <section className="item-views-section" aria-labelledby="item-views-best-heading">
              <h2 id="item-views-best-heading" className="item-views-section-title">
                Best categories by views
              </h2>
              {renderCategoryPie(bestCategoryPie, bestCategoryPieOptions)}
            </section>

            <section className="item-views-section" aria-labelledby="item-views-worst-heading">
              <h2 id="item-views-worst-heading" className="item-views-section-title">
                Worst categories by views
              </h2>
              {renderCategoryPie(worstCategoryPie, worstCategoryPieOptions)}
            </section>
          </div>

          <section className="item-views-feed-section" aria-label="Listing views feed">
            <div className="item-views-feed-header">
              <div
                className="item-views-feed-toggle"
                role="tablist"
                aria-label="Listing views ranking"
              >
                <button
                  type="button"
                  role="tab"
                  id="item-views-feed-tab-best"
                  aria-selected={listingFeedMode === 'best'}
                  aria-controls="item-views-feed-panel"
                  className={`item-views-feed-toggle-btn${
                    listingFeedMode === 'best' ? ' item-views-feed-toggle-btn--active' : ''
                  }`}
                  onClick={() => setListingFeedMode('best')}
                >
                  Best
                </button>
                <button
                  type="button"
                  role="tab"
                  id="item-views-feed-tab-worst"
                  aria-selected={listingFeedMode === 'worst'}
                  aria-controls="item-views-feed-panel"
                  className={`item-views-feed-toggle-btn${
                    listingFeedMode === 'worst' ? ' item-views-feed-toggle-btn--active' : ''
                  }`}
                  onClick={() => setListingFeedMode('worst')}
                >
                  Worst
                </button>
              </div>
            </div>

            <div
              id="item-views-feed-panel"
              role="tabpanel"
              aria-labelledby={
                listingFeedMode === 'best' ? 'item-views-feed-tab-best' : 'item-views-feed-tab-worst'
              }
            >
              {renderListingFeed(activeFeedRows)}
            </div>
          </section>

          <div className="item-views-footer">
            <button type="button" className="item-views-refresh" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </>
      )}

      {selectedListing && (
        <div
          className="item-views-modal-backdrop"
          role="presentation"
          onClick={closeListingModal}
        >
          <div
            className="item-views-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-views-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="item-views-modal-close"
              aria-label="Close"
              onClick={closeListingModal}
            >
              ×
            </button>
            <div className="item-views-modal-media">
              {selectedListing.imageUrl ? (
                <img
                  src={selectedListing.imageUrl}
                  alt=""
                  className="item-views-modal-image"
                />
              ) : (
                <div className="item-views-feed-card-fallback item-views-modal-fallback" aria-hidden="true">
                  {(selectedListing.listingTitle || selectedListing.itemName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="item-views-modal-body">
              <h3 id="item-views-modal-title" className="item-views-modal-title">
                {selectedListing.listingTitle?.trim() ||
                  selectedListing.itemName?.trim() ||
                  `Stock #${selectedListing.stockId}`}
              </h3>
              {selectedListing.priceLabel?.trim() ? (
                <p className="item-views-modal-price">{selectedListing.priceLabel.trim()}</p>
              ) : null}
              {selectedListing.listingDate ? (
                <p className="item-views-modal-listed">
                  Listed {formatListingDate(selectedListing.listingDate)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResearchItemViews;
