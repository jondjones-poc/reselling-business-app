import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './Stock.css';
import './ResearchEbayFeed.css';
import './ResearchSellerSolds.css';

type TrackedSeller = { id: number; username: string; created_at?: string };
type SoldItem = {
  itemId: string | null;
  title: string;
  imageUrl: string | null;
  priceLabel: string;
  itemWebUrl: string | null;
  sellerId: number;
  sellerUsername: string;
  soldAtMs?: number;
};

const SOLD_DAYS_OPTIONS = [7, 30, 60, 90, 180, 365] as const;

/** £20–£200 in £5 steps (matches tag feed) */
const MIN_PRICE_OPTIONS: number[] = (() => {
  const o: number[] = [];
  for (let v = 20; v <= 200; v += 5) {
    o.push(v);
  }
  return o;
})();

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function sortSoldNewestFirst(items: SoldItem[]): SoldItem[] {
  return [...items].sort((a, b) => (b.soldAtMs ?? 0) - (a.soldAtMs ?? 0));
}

function dedupeByItemId(existing: SoldItem[], incoming: SoldItem[]): SoldItem[] {
  const seen = new Set(existing.map((i) => i.itemId).filter(Boolean) as string[]);
  const out = [...existing];
  for (const it of incoming) {
    if (!it.itemId || seen.has(it.itemId)) continue;
    seen.add(it.itemId);
    out.push(it);
  }
  return out;
}

function formatSoldDate(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ebayUkSellerProfileUrl(username: string): string {
  return `https://www.ebay.co.uk/usr/${encodeURIComponent(username.trim())}`;
}

const ResearchSellerSolds: React.FC = () => {
  const [sellers, setSellers] = useState<TrackedSeller[]>([]);
  const [sellersLoading, setSellersLoading] = useState(true);
  const [sellersError, setSellersError] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [items, setItems] = useState<SoldItem[]>([]);
  const [feedPage, setFeedPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedWarn, setFeedWarn] = useState<string | null>(null);
  const [feedDiagnostics, setFeedDiagnostics] = useState<string | null>(null);

  const [soldDays, setSoldDays] = useState<number>(7);
  const [minPriceGbp, setMinPriceGbp] = useState(25);

  const loadInFlight = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadSellers = useCallback(async (): Promise<TrackedSeller[]> => {
    setSellersLoading(true);
    setSellersError(null);
    try {
      const res = await fetch(apiUrl('/api/research-seller/sellers'));
      const data = await readJson<{ rows?: TrackedSeller[]; error?: string; hint?: string; details?: string }>(res);
      if (!res.ok) {
        throw new Error([data.error, data.details, data.hint].filter(Boolean).join(' — ') || res.statusText);
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setSellers(rows);
      return rows;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load sellers';
      setSellersError(msg);
      setSellers([]);
      return [];
    } finally {
      setSellersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSellers();
  }, [loadSellers]);

  const fetchFeedPage = useCallback(
    async (page: number, append: boolean, sellerCount?: number, refresh = false) => {
      const activeCount = sellerCount ?? sellers.length;
      if (activeCount === 0) {
        setItems([]);
        setHasMore(false);
        setFeedPage(0);
        return;
      }
      if (loadInFlight.current) return;
      loadInFlight.current = true;
      setFeedLoading(true);
      setFeedError(null);
      if (!append) {
        setFeedWarn(null);
        setFeedDiagnostics(null);
      }
      try {
        const params = new URLSearchParams({
          page: String(page),
          soldDays: String(soldDays),
          minPriceGbp: String(minPriceGbp),
        });
        if (refresh) params.set('refresh', '1');
        const res = await fetch(apiUrl(`/api/research-seller/items?${params.toString()}`));
        const data = await readJson<{
          items?: SoldItem[];
          hasMore?: boolean;
          errors?: { sellerUsername: string; error: string }[] | string[];
          diagnostics?: {
            cached?: boolean;
            cacheSource?: string | null;
            categoryCount?: number;
            categories?: string[];
            sellerCount?: number;
            soldDays?: number;
            minPriceGbp?: number;
            errors?: string[];
          };
          emptyHint?: string | null;
          error?: string;
          details?: string;
        }>(res);
        if (!res.ok) {
          const parts = [data.error, data.details].filter(Boolean);
          throw new Error(parts.join(' — ') || res.statusText);
        }
        const nextItems = Array.isArray(data.items) ? data.items : [];
        setItems((prev) =>
          sortSoldNewestFirst(
            append ? dedupeByItemId(prev, nextItems) : dedupeByItemId([], nextItems)
          )
        );
        setHasMore(Boolean(data.hasMore));
        setFeedPage(page);

        const diagnosticErrors = data.diagnostics?.errors;
        const errorLines = [
          ...(Array.isArray(data.errors)
            ? data.errors.map((x) => (typeof x === 'string' ? x : x.error)).filter(Boolean)
            : []),
          ...(Array.isArray(diagnosticErrors) ? diagnosticErrors : []),
        ];
        const uniqueErrors = Array.from(new Set(errorLines));

        if (uniqueErrors.length > 0) {
          setFeedError(uniqueErrors.join('\n'));
          setFeedWarn(null);
        } else if (nextItems.length === 0 && data.emptyHint) {
          setFeedError(null);
          setFeedWarn(data.emptyHint);
        } else {
          setFeedError(null);
        }

        if (data.diagnostics && !append) {
          const d = data.diagnostics;
          const parts: string[] = [];
          if (d.cached) {
            parts.push(
              d.cacheSource === 'database' ? 'Loaded from database cache (12h)' : 'Showing cached results'
            );
          }
          if (d.categoryCount != null) {
            parts.push(`${d.categoryCount} categor${d.categoryCount === 1 ? 'y' : 'ies'} searched`);
          }
          if (d.categories && d.categories.length > 0) {
            parts.push(d.categories.join(', '));
          }
          setFeedDiagnostics(parts.length > 0 ? parts.join(' · ') : null);
        }
      } catch (e) {
        setFeedError(e instanceof Error ? e.message : 'Feed request failed');
        if (!append) setItems([]);
      } finally {
        setFeedLoading(false);
        loadInFlight.current = false;
      }
    },
    [sellers.length, soldDays, minPriceGbp]
  );

  useEffect(() => {
    if (sellersLoading) return;
    if (sellers.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    void fetchFeedPage(0, false);
  }, [sellers, sellersLoading, fetchFeedPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || feedLoading || sellers.length === 0) return;
    void fetchFeedPage(feedPage + 1, true);
  }, [hasMore, feedLoading, sellers.length, feedPage, fetchFeedPage]);

  const handleRefreshFeed = useCallback(async () => {
    const loaded = await loadSellers();
    if (loaded.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    void fetchFeedPage(0, false, loaded.length, true);
  }, [loadSellers, fetchFeedPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || sellers.length === 0) return undefined;

    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((en) => en.isIntersecting);
        if (hit) loadMore();
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, sellers.length, items.length]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = newUsername.trim().replace(/^@+/, '');
    if (!username || addBusy) return;
    setAddBusy(true);
    setSellersError(null);
    try {
      const res = await fetch(apiUrl('/api/research-seller/sellers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await readJson<{ row?: TrackedSeller; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (data.row) {
        setSellers((prev) => {
          const without = prev.filter((s) => s.id !== data.row!.id);
          return [...without, data.row!].sort((a, b) => a.id - b.id);
        });
      }
      setNewUsername('');
    } catch (err) {
      setSellersError(err instanceof Error ? err.message : 'Could not add seller');
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemove = async (id: number) => {
    setSellersError(null);
    try {
      const res = await fetch(apiUrl(`/api/research-seller/sellers/${id}`), { method: 'DELETE' });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setSellers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setSellersError(err instanceof Error ? err.message : 'Could not remove seller');
    }
  };

  return (
    <div className="research-ebay-feed research-seller-solds">
      <form className="research-ebay-feed-toolbar" onSubmit={handleAdd}>
        <input
          className="search-input research-ebay-feed-toolbar-search"
          value={newUsername}
          onChange={(ev) => setNewUsername(ev.target.value)}
          placeholder="eBay seller username"
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          aria-label="eBay seller username"
        />
        <button type="submit" className="new-entry-button" disabled={addBusy || !newUsername.trim()}>
          {addBusy ? 'Adding…' : 'Add seller'}
        </button>
      </form>

      <div className="stock-filters research-ebay-feed-filters" role="group" aria-label="Feed filters">
        <div className="filter-group research-ebay-feed-filter-group">
          <label className="research-ebay-feed-filters-label" htmlFor="research-seller-solds-min-price">
            Min. price
          </label>
          <select
            id="research-seller-solds-min-price"
            className="filter-select research-ebay-feed-filter-select"
            value={minPriceGbp}
            onChange={(ev) => setMinPriceGbp(Number(ev.target.value))}
            title="Minimum sold price in GBP"
          >
            {MIN_PRICE_OPTIONS.map((p) => (
              <option key={`min-${p}`} value={p}>
                £{p}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group research-ebay-feed-filter-group">
          <label className="research-ebay-feed-filters-label" htmlFor="research-seller-solds-days">
            Sold within
          </label>
          <select
            id="research-seller-solds-days"
            className="filter-select research-ebay-feed-filter-select"
            value={soldDays}
            onChange={(ev) => setSoldDays(Number(ev.target.value))}
            title="How far back to search sold listings"
          >
            {SOLD_DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group view-group research-ebay-feed-filter-refresh">
          <button
            type="button"
            className="stock-refresh-icon-button"
            onClick={() => void handleRefreshFeed()}
            disabled={sellers.length === 0 || feedLoading || sellersLoading}
            title="Refresh seller list and feed"
            aria-label="Refresh seller list and feed"
          >
            ↻
          </button>
        </div>
      </div>

      {sellersError && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--error" role="alert">
          {sellersError}
        </div>
      )}

      <div className="research-ebay-feed-tags" aria-label="Tracked sellers">
        {sellersLoading && <span className="research-ebay-feed-muted">Loading sellers…</span>}
        {sellers.map((s, i) => (
          <span
            key={s.id}
            className={`research-ebay-feed-chip research-ebay-feed-chip--tone-${i % 6}`}
          >
            <a
              href={ebayUkSellerProfileUrl(s.username)}
              target="_blank"
              rel="noopener noreferrer"
              className="research-seller-solds-chip-label"
              title={`Open @${s.username} on eBay`}
            >
              @{s.username}
            </a>
            <button
              type="button"
              className="research-ebay-feed-chip-remove"
              onClick={() => void handleRemove(s.id)}
              aria-label={`Remove seller ${s.username}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {feedWarn && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--warn" role="status">
          {feedWarn}
        </div>
      )}

      {feedDiagnostics && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--info" role="status">
          {feedDiagnostics}
        </div>
      )}

      {feedError && (
        <div
          className="research-ebay-feed-banner research-ebay-feed-banner--error"
          role="alert"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {feedError}
        </div>
      )}

      {sellers.length > 0 && feedLoading && items.length === 0 && (
        <div className="research-ebay-feed-grid" aria-busy="true" aria-label="Loading sold feed">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="research-ebay-feed-skeleton" />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="research-ebay-feed-grid">
          {items.map((it) => {
            const href = it.itemWebUrl || (it.itemId ? `https://www.ebay.co.uk/itm/${it.itemId}` : null);
            const soldDate = formatSoldDate(it.soldAtMs);
            const inner = (
              <>
                <div className="research-ebay-feed-card-media">
                  {it.imageUrl ? (
                    <img src={it.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : null}
                </div>
                <div className="research-ebay-feed-card-body">
                  <div className="research-ebay-feed-card-tag">@{it.sellerUsername}</div>
                  <h3 className="research-ebay-feed-card-title">{it.title || 'Listing'}</h3>
                  <div className="research-ebay-feed-card-price">{it.priceLabel}</div>
                  {soldDate ? (
                    <div className="research-seller-solds-card-date">Sold {soldDate}</div>
                  ) : null}
                </div>
              </>
            );
            return (
              <article key={`${it.itemId}-${it.sellerId}`} className="research-ebay-feed-card">
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="research-ebay-feed-card-link"
                  >
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </article>
            );
          })}
        </div>
      )}

      {sellers.length === 0 && !sellersLoading && !sellersError && (
        <p className="research-ebay-feed-muted">
          Add an eBay seller username above to start tracking their sold listings.
        </p>
      )}

      {sellers.length > 0 && items.length > 0 && (
        <div ref={sentinelRef} className="research-ebay-feed-sentinel" aria-hidden />
      )}

      {sellers.length > 0 && items.length > 0 && feedLoading && (
        <div className="research-ebay-feed-grid" style={{ marginTop: '1rem' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`sk-${i}`} className="research-ebay-feed-skeleton" />
          ))}
        </div>
      )}

      {hasMore && !feedLoading && items.length > 0 && (
        <div className="research-ebay-feed-load-more-wrap">
          <button type="button" className="research-ebay-feed-load-more" onClick={() => loadMore()}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
};

export default ResearchSellerSolds;
