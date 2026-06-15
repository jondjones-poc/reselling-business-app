import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiBase';
import './Stock.css';
import './ResearchEbayFeed.css';
import './ResearchSellerSolds.css';

type TrackedSeller = {
  id: number;
  username: string;
  store_slug?: string | null;
  storeUrl?: string;
  created_at?: string;
};
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

const SOLD_DAYS_OPTIONS = [7, 14, 30, 60, 90, 180, 365] as const;

type FeedFetchMode = 'cacheOnly' | 'refresh';

const LISTING_MODE = 'listings' as const;

type SellerRefreshProgress = {
  running?: boolean;
  phase?: string;
  username?: string;
  itemsFound?: number;
  itemsCached?: number;
  categoriesDone?: number;
  categoriesTotal?: number;
  currentCategory?: string | null;
  apiPages?: number;
  startedAt?: number;
  elapsedMs?: number;
  refreshedItemCount?: number;
  error?: string;
  alreadyRunning?: boolean;
};

type FeedApiResponse = {
  items?: SoldItem[];
  hasMore?: boolean;
  errors?: { sellerUsername: string; error: string }[] | string[];
  diagnostics?: {
    cached?: boolean;
    cacheSource?: string | null;
    categoryCount?: number | null;
    categories?: string[];
    sellerCount?: number;
    sellerItemCounts?: Record<string, number>;
    soldDays?: number;
    minPriceGbp?: number;
    staleCache?: boolean;
    scheduledCache?: boolean;
    cacheUpdatedAt?: string | null;
    errors?: string[];
  };
  totalCached?: number;
  emptyHint?: string | null;
  error?: string;
  details?: string;
};

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

function feedItemIdsKey(items: SoldItem[]): string {
  return items
    .map((i) => i.itemId)
    .filter(Boolean)
    .join('|');
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `0:${String(s).padStart(2, '0')}`;
}

function formatSellerRefreshProgress(
  username: string,
  progress: SellerRefreshProgress | null,
  elapsedMs: number
): string {
  const elapsed = formatElapsed(elapsedMs);
  const parts: string[] = [`@${username}`, elapsed];
  const phase = progress?.phase ?? 'starting';

  if (phase === 'discovering') {
    parts.push('finding categories on eBay');
  } else if (phase === 'fetching') {
    const found = progress?.itemsFound ?? 0;
    const cached = progress?.itemsCached ?? 0;
    if (found > 0) parts.push(`${found} listing${found === 1 ? '' : 's'} found`);
    if (cached > 0 && cached !== found) parts.push(`${cached} saved to cache`);
    if (progress?.currentCategory) {
      const catProgress =
        progress.categoriesTotal != null && progress.categoriesTotal > 0
          ? ` (${(progress.categoriesDone ?? 0) + 1}/${progress.categoriesTotal})`
          : '';
      parts.push(`${progress.currentCategory}${catProgress}`);
    }
    if ((progress?.apiPages ?? 0) > 0) {
      parts.push(`${progress!.apiPages} eBay page${progress!.apiPages === 1 ? '' : 's'}`);
    }
  } else if (phase === 'saving') {
    parts.push(`saving ${progress?.itemsFound ?? 0} listing${(progress?.itemsFound ?? 0) === 1 ? '' : 's'}…`);
  } else if (phase === 'starting') {
    parts.push('starting eBay fetch…');
  } else {
    parts.push('working…');
  }

  return parts.join(' · ');
}

function formatSoldDate(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ebayUkSellerStoreUrl(seller: Pick<TrackedSeller, 'username' | 'store_slug' | 'storeUrl'>): string {
  if (seller.storeUrl) return seller.storeUrl;
  const slug =
    (seller.store_slug && seller.store_slug.trim()) ||
    (seller.username.includes('.') ? seller.username.replace(/\./g, '') : seller.username.trim());
  return `https://www.ebay.co.uk/str/${encodeURIComponent(slug)}`;
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

  const [soldDays, setSoldDays] = useState<number>(14);
  const [minPriceGbp, setMinPriceGbp] = useState(25);

  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [refreshingSellerId, setRefreshingSellerId] = useState<number | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<SellerRefreshProgress | null>(null);
  const [refreshElapsedMs, setRefreshElapsedMs] = useState(0);
  const [sellerCachedCounts, setSellerCachedCounts] = useState<Record<number, number>>({});

  const loadInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const feedLoadGeneration = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const refreshPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshStartedAtRef = useRef(0);
  const lastCachedReloadRef = useRef(0);

  const loadSellers = useCallback(async (): Promise<TrackedSeller[]> => {
    setSellersLoading(true);
    setSellersError(null);
    try {
      const res = await apiFetch('/api/research-seller/sellers');
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

  const requestFeedItems = useCallback(
    async (page: number, mode: FeedFetchMode): Promise<FeedApiResponse> => {
      const params = new URLSearchParams({
        page: String(page),
        soldDays: String(soldDays),
        minPriceGbp: String(minPriceGbp),
        listingMode: LISTING_MODE,
      });
      if (mode === 'cacheOnly') params.set('cacheOnly', '1');
      if (mode === 'refresh') params.set('refresh', '1');
      const res = await apiFetch(`/api/research-seller/items?${params.toString()}`);
      const data = await readJson<FeedApiResponse>(res);
      if (!res.ok) {
        const parts = [data.error, data.details].filter(Boolean);
        throw new Error(parts.join(' — ') || res.statusText);
      }
      return data;
    },
    [soldDays, minPriceGbp]
  );

  const applyFeedResponse = useCallback(
    (
      data: FeedApiResponse,
      page: number,
      append: boolean,
      options?: { skipIfSameItems?: boolean; refreshing?: boolean }
    ) => {
      const nextItems = Array.isArray(data.items) ? data.items : [];
      if (options?.skipIfSameItems && !append) {
        setItems((prev) => {
          if (feedItemIdsKey(prev) === feedItemIdsKey(nextItems)) return prev;
          return sortSoldNewestFirst(dedupeByItemId([], nextItems));
        });
      } else {
        setItems((prev) =>
          sortSoldNewestFirst(
            append ? dedupeByItemId(prev, nextItems) : dedupeByItemId([], nextItems)
          )
        );
      }
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
      } else if (!options?.refreshing) {
        setFeedError(null);
      }

      if (!append) {
        if (data.diagnostics?.sellerItemCounts) {
          setSellerCachedCounts((prev) => {
            const next = { ...prev };
            for (const s of sellers) {
              const count = data.diagnostics!.sellerItemCounts![s.username];
              if (count != null && count > 0) {
                next[s.id] = count;
              } else {
                delete next[s.id];
              }
            }
            return next;
          });
        }
      }
    },
    [sellers]
  );

  const fetchFeedPage = useCallback(
    async (
      page: number,
      append: boolean,
      sellerCount?: number,
      mode: FeedFetchMode = 'cacheOnly'
    ) => {
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
      }
      try {
        const data = await requestFeedItems(page, mode);
        applyFeedResponse(data, page, append, {
          refreshing: mode === 'refresh' && !append,
        });
      } catch (e) {
        setFeedError(e instanceof Error ? e.message : 'Feed request failed');
        if (!append) setItems([]);
      } finally {
        setFeedLoading(false);
        loadInFlight.current = false;
      }
    },
    [sellers.length, requestFeedItems, applyFeedResponse]
  );

  const loadFeedFromCache = useCallback(
    async (sellerCount?: number) => {
      await fetchFeedPage(0, false, sellerCount, 'cacheOnly');
    },
    [fetchFeedPage]
  );

  useEffect(() => {
    if (sellersLoading) return;
    if (sellers.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    feedLoadGeneration.current += 1;
    void loadFeedFromCache();
  }, [sellers, sellersLoading, soldDays, minPriceGbp, loadFeedFromCache]);

  const loadMore = useCallback(() => {
    if (!hasMore || feedLoading || sellers.length === 0) return;
    void fetchFeedPage(feedPage + 1, true);
  }, [hasMore, feedLoading, sellers.length, feedPage, fetchFeedPage]);

  const stopSellerRefreshTimers = useCallback(() => {
    if (refreshPollRef.current) {
      clearInterval(refreshPollRef.current);
      refreshPollRef.current = null;
    }
    if (refreshElapsedRef.current) {
      clearInterval(refreshElapsedRef.current);
      refreshElapsedRef.current = null;
    }
  }, []);

  useEffect(() => () => stopSellerRefreshTimers(), [stopSellerRefreshTimers]);

  const pollSellerRefreshProgress = useCallback(
    async (seller: TrackedSeller): Promise<SellerRefreshProgress> => {
      const params = new URLSearchParams({
        soldDays: String(soldDays),
        minPriceGbp: String(minPriceGbp),
        listingMode: LISTING_MODE,
      });
      const res = await apiFetch(
        `/api/research-seller/sellers/${seller.id}/refresh/progress?${params.toString()}`
      );
      const data = await readJson<SellerRefreshProgress & { ok?: boolean; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setRefreshProgress(data);
      setRefreshElapsedMs(
        data.elapsedMs ?? Math.max(0, Date.now() - refreshStartedAtRef.current)
      );

      const cached = data.itemsCached ?? 0;
      if (cached > 0) {
        setSellerCachedCounts((prev) => ({ ...prev, [seller.id]: cached }));
      }
      if (
        cached > 0 &&
        cached - lastCachedReloadRef.current >= 12 &&
        (data.phase === 'fetching' || data.phase === 'saving')
      ) {
        lastCachedReloadRef.current = cached;
        void loadFeedFromCache();
      }

      return data;
    },
    [soldDays, minPriceGbp, loadFeedFromCache]
  );

  const handleRefreshSeller = useCallback(
    async (seller: TrackedSeller) => {
      if (refreshingSellerId != null || feedRefreshing) return;

      stopSellerRefreshTimers();
      lastCachedReloadRef.current = 0;
      refreshStartedAtRef.current = Date.now();
      setRefreshElapsedMs(0);
      setRefreshProgress({ phase: 'starting', running: true, itemsFound: 0, itemsCached: 0 });
      setRefreshingSellerId(seller.id);
      setFeedError(null);
      setFeedWarn(null);

      refreshElapsedRef.current = setInterval(() => {
        setRefreshElapsedMs(Math.max(0, Date.now() - refreshStartedAtRef.current));
      }, 1000);

      const finishRefresh = () => {
        stopSellerRefreshTimers();
        setRefreshingSellerId(null);
        setRefreshProgress(null);
        setRefreshElapsedMs(0);
      };

      try {
        const params = new URLSearchParams({
          soldDays: String(soldDays),
          minPriceGbp: String(minPriceGbp),
          listingMode: LISTING_MODE,
        });
        const res = await apiFetch(
          `/api/research-seller/sellers/${seller.id}/refresh?${params.toString()}`,
          { method: 'POST' }
        );
        const startData = await readJson<{
          ok?: boolean;
          started?: boolean;
          alreadyRunning?: boolean;
          progress?: SellerRefreshProgress;
          error?: string;
          details?: string;
        }>(res);

        if (!res.ok && res.status !== 202) {
          const parts = [startData.error, startData.details].filter(Boolean);
          throw new Error(parts.join(' — ') || res.statusText);
        }

        if (startData.progress) {
          setRefreshProgress(startData.progress);
        }

        refreshPollRef.current = setInterval(() => {
          void pollSellerRefreshProgress(seller)
            .then((progress) => {
              if (progress.running) return;
              if (progress.phase === 'error') {
                finishRefresh();
                setFeedError(progress.error || `Could not refresh @${seller.username}`);
                return;
              }
              if (progress.phase === 'done') {
                finishRefresh();
                void loadFeedFromCache().then(() => {
                  const count = progress.refreshedItemCount ?? progress.itemsFound ?? 0;
                  setFeedWarn(
                    count > 0
                      ? `Updated @${seller.username}: ${count} active listing${count === 1 ? '' : 's'} cached from eBay.`
                      : `No active listings found for @${seller.username} at current filters.`
                  );
                });
              }
            })
            .catch((err) => {
              finishRefresh();
              setFeedError(err instanceof Error ? err.message : `Could not refresh @${seller.username}`);
            });
        }, 1500);

        const firstProgress = await pollSellerRefreshProgress(seller);
        if (!firstProgress.running && firstProgress.phase === 'done') {
          finishRefresh();
          await loadFeedFromCache();
          const count = firstProgress.refreshedItemCount ?? firstProgress.itemsFound ?? 0;
          setFeedWarn(
            count > 0
              ? `Updated @${seller.username}: ${count} active listing${count === 1 ? '' : 's'} cached from eBay.`
              : `No active listings found for @${seller.username} at current filters.`
          );
        } else if (!firstProgress.running && firstProgress.phase === 'error') {
          finishRefresh();
          setFeedError(firstProgress.error || `Could not refresh @${seller.username}`);
        }
      } catch (err) {
        finishRefresh();
        setFeedError(err instanceof Error ? err.message : `Could not refresh @${seller.username}`);
      }
    },
    [
      refreshingSellerId,
      feedRefreshing,
      soldDays,
      minPriceGbp,
      loadFeedFromCache,
      pollSellerRefreshProgress,
      stopSellerRefreshTimers,
    ]
  );

  const handleRefreshFeed = useCallback(async () => {
    const loaded = await loadSellers();
    if (loaded.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setFeedRefreshing(true);
    setFeedError(null);
    setFeedWarn(null);
    try {
      await fetchFeedPage(0, false, loaded.length, 'refresh');
    } finally {
      setFeedRefreshing(false);
      refreshInFlight.current = false;
    }
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
    const username = newUsername.trim();
    if (!username || addBusy) return;
    setAddBusy(true);
    setSellersError(null);
    try {
      const res = await apiFetch('/api/research-seller/sellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await readJson<{
        row?: TrackedSeller;
        error?: string;
        details?: string;
        profileUrl?: string;
        storeUrl?: string;
        verifyWarning?: string;
        resolvedNote?: string;
        resolvedFrom?: string;
      }>(res);
      if (!res.ok) {
        const parts = [data.error, data.details].filter(Boolean);
        throw new Error(parts.join('\n\n') || res.statusText);
      }
      if (data.resolvedNote) {
        setFeedWarn(data.resolvedNote);
      } else if (data.verifyWarning) {
        setFeedWarn(data.verifyWarning);
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
      const res = await apiFetch(`/api/research-seller/sellers/${id}`, { method: 'DELETE' });
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
      <form className="research-seller-solds-toolbar-row" onSubmit={handleAdd}>
        <input
          className="search-input research-seller-solds-toolbar-search"
          value={newUsername}
          onChange={(ev) => setNewUsername(ev.target.value)}
          placeholder="Username, store URL, or sold listing URL"
          maxLength={240}
          autoComplete="off"
          spellCheck={false}
          aria-label="eBay seller username"
        />
        <button type="submit" className="new-entry-button" disabled={addBusy || !newUsername.trim()}>
          {addBusy ? 'Adding…' : 'Add seller'}
        </button>
        <button
          type="button"
          className="stock-refresh-icon-button research-seller-solds-toolbar-refresh"
          onClick={() => void handleRefreshFeed()}
          disabled={sellers.length === 0 || sellersLoading || feedRefreshing}
          title="Refresh all sellers from eBay (or use ↻ on each seller)"
          aria-label="Refresh seller list and feed"
        >
          ↻
        </button>
        <select
          id="research-seller-solds-min-price"
          className="filter-select research-seller-solds-toolbar-select"
          value={minPriceGbp}
          onChange={(ev) => setMinPriceGbp(Number(ev.target.value))}
          aria-label="Minimum listing price in GBP"
          title="Minimum listing price in GBP"
        >
          {MIN_PRICE_OPTIONS.map((p) => (
            <option key={`min-${p}`} value={p}>
              £{p}
            </option>
          ))}
        </select>
        <select
          id="research-seller-solds-days"
          className="filter-select research-seller-solds-toolbar-select"
          value={soldDays}
          onChange={(ev) => setSoldDays(Number(ev.target.value))}
          aria-label="Listed within days"
          title="How far back to search active listings"
        >
          {SOLD_DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </form>

      {sellersError && (
        <div
          className="research-ebay-feed-banner research-ebay-feed-banner--error"
          role="alert"
          style={{ whiteSpace: 'pre-wrap' }}
        >
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
              href={ebayUkSellerStoreUrl(s)}
              target="_blank"
              rel="noopener noreferrer"
              className="research-seller-solds-chip-label"
              title={`Open @${s.username} eBay store (${ebayUkSellerStoreUrl(s)})`}
            >
              @{s.username}
              {sellerCachedCounts[s.id] != null && sellerCachedCounts[s.id] > 0
                ? ` (${sellerCachedCounts[s.id]})`
                : null}
            </a>
            <button
              type="button"
              className={`research-seller-solds-chip-refresh${
                refreshingSellerId === s.id ? ' research-seller-solds-chip-refresh--busy' : ''
              }`}
              onClick={() => void handleRefreshSeller(s)}
              disabled={refreshingSellerId != null || feedRefreshing || feedLoading}
              title={
                refreshingSellerId === s.id
                  ? `Refreshing @${s.username} from eBay…`
                  : `Refresh active listings for @${s.username} from eBay`
              }
              aria-label={
                refreshingSellerId === s.id
                  ? `Refreshing active listings for ${s.username}`
                  : `Refresh active listings for ${s.username}`
              }
              aria-busy={refreshingSellerId === s.id}
            >
              <span className="research-seller-solds-chip-refresh-icon" aria-hidden="true">
                ↻
              </span>
            </button>
            <button
              type="button"
              className="research-ebay-feed-chip-remove"
              onClick={() => void handleRemove(s.id)}
              disabled={refreshingSellerId != null}
              aria-label={`Remove seller ${s.username}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {refreshingSellerId != null && (
        <div
          className="research-ebay-feed-banner research-seller-solds-refresh-progress"
          role="status"
          aria-live="polite"
        >
          <span className="research-seller-solds-refresh-progress-icon" aria-hidden="true">
            ↻
          </span>
          {formatSellerRefreshProgress(
            sellers.find((s) => s.id === refreshingSellerId)?.username ?? 'seller',
            refreshProgress,
            refreshElapsedMs
          )}
        </div>
      )}

      {feedWarn && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--warn" role="status">
          {feedWarn}
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
        <div className="research-ebay-feed-grid" aria-busy="true" aria-label="Loading listings feed">
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
                    <div className="research-seller-solds-card-date">
                      Listed {soldDate}
                    </div>
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

      {sellers.length > 0 && !feedLoading && items.length === 0 && !feedError && !feedWarn && (
        <p className="research-ebay-feed-muted">
          No active listings to show. Cached data refreshes daily around 4pm GMT. Try ↻ for a live fetch, widen the days window, or lower min price.
        </p>
      )}

      {sellers.length === 0 && !sellersLoading && !sellersError && (
        <p className="research-ebay-feed-muted">
          Add an eBay seller username above to track their active listings.
        </p>
      )}

      {sellers.length > 0 && items.length > 0 && (
        <div ref={sentinelRef} className="research-ebay-feed-sentinel" aria-hidden />
      )}

      {sellers.length > 0 && items.length > 0 && (feedLoading || feedRefreshing) && (
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
