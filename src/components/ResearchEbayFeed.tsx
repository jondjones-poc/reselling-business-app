import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './Stock.css';
import './ResearchEbayFeed.css';

type FeedTag = { id: number; term: string; created_at?: string };
type FeedItem = {
  itemId: string | null;
  title: string;
  imageUrl: string | null;
  priceLabel: string;
  itemWebUrl: string | null;
  tagId: number;
  tagTerm: string;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function dedupeByItemId(existing: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const seen = new Set(existing.map((i) => i.itemId).filter(Boolean) as string[]);
  const out = [...existing];
  for (const it of incoming) {
    if (!it.itemId || seen.has(it.itemId)) continue;
    seen.add(it.itemId);
    out.push(it);
  }
  return out;
}

/** £20–£200 in £5 steps for feed price filters */
const FEED_PRICE_OPTIONS: number[] = (() => {
  const o: number[] = [];
  for (let v = 20; v <= 200; v += 5) {
    o.push(v);
  }
  return o;
})();

const ResearchEbayFeed: React.FC = () => {
  const [tags, setTags] = useState<FeedTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [feedPage, setFeedPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedWarn, setFeedWarn] = useState<string | null>(null);

  const [minPriceGbp, setMinPriceGbp] = useState(50);
  const [maxPriceGbp, setMaxPriceGbp] = useState(200);

  const loadInFlight = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    setTagsError(null);
    try {
      const res = await fetch(apiUrl('/api/research-feed/tags'));
      const data = await readJson<{ rows?: FeedTag[] }>(res);
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || res.statusText);
      }
      setTags(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setTagsError(e instanceof Error ? e.message : 'Could not load tags');
      setTags([]);
    } finally {
      setTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const fetchFeedPage = useCallback(async (page: number, append: boolean) => {
    if (tags.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setFeedLoading(true);
    setFeedError(null);
    if (!append) setFeedWarn(null);
    try {
      const res = await fetch(
        apiUrl(
          `/api/research-feed/items?page=${page}&pageSize=12&minPriceGbp=${minPriceGbp}&maxPriceGbp=${maxPriceGbp}`
        )
      );
      const data = await readJson<{
        items?: FeedItem[];
        hasMore?: boolean;
        errors?: { tagTerm: string; error: string }[];
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => (append ? dedupeByItemId(prev, nextItems) : dedupeByItemId([], nextItems)));
      setHasMore(Boolean(data.hasMore));
      setFeedPage(page);
      if (data.errors && data.errors.length > 0) {
        setFeedWarn(data.errors.map((x) => `${x.tagTerm}: ${x.error}`).join(' · '));
      }
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : 'Feed request failed');
      if (!append) setItems([]);
    } finally {
      setFeedLoading(false);
      loadInFlight.current = false;
    }
  }, [tags.length, minPriceGbp, maxPriceGbp]);

  useEffect(() => {
    if (tagsLoading) return;
    if (tags.length === 0) {
      setItems([]);
      setHasMore(false);
      setFeedPage(0);
      return;
    }
    void fetchFeedPage(0, false);
  }, [tags, tagsLoading, fetchFeedPage]);

  const loadMore = useCallback(() => {
    if (!hasMore || feedLoading || tags.length === 0) return;
    void fetchFeedPage(feedPage + 1, true);
  }, [hasMore, feedLoading, tags.length, feedPage, fetchFeedPage]);

  const handleRefreshFeed = useCallback(() => {
    if (tags.length === 0) return;
    void fetchFeedPage(0, false);
  }, [tags.length, fetchFeedPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || tags.length === 0) return undefined;

    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((en) => en.isIntersecting);
        if (hit) loadMore();
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, tags.length, items.length]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = newTag.trim();
    if (!term || addBusy) return;
    setAddBusy(true);
    setTagsError(null);
    try {
      const res = await fetch(apiUrl('/api/research-feed/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term }),
      });
      const data = await readJson<{ row?: FeedTag; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (data.row) {
        setTags((prev) => {
          const without = prev.filter((t) => t.id !== data.row!.id);
          return [...without, data.row!].sort((a, b) => a.id - b.id);
        });
      }
      setNewTag('');
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : 'Could not add tag');
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemove = async (id: number) => {
    setTagsError(null);
    try {
      const res = await fetch(apiUrl(`/api/research-feed/tags/${id}`), { method: 'DELETE' });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setTags((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : 'Could not remove tag');
    }
  };

  return (
    <div className="research-ebay-feed">
      <form className="research-ebay-feed-toolbar" onSubmit={handleAdd}>
        <input
          className="search-input research-ebay-feed-toolbar-search"
          value={newTag}
          onChange={(ev) => setNewTag(ev.target.value)}
          placeholder='e.g. Vintage IKEA, "designer coat"'
          maxLength={120}
          aria-label="New feed tag"
        />
        <button type="submit" className="new-entry-button" disabled={addBusy || !newTag.trim()}>
          {addBusy ? 'Adding…' : 'Add tag'}
        </button>
      </form>

      <div className="stock-filters research-ebay-feed-filters" role="group" aria-label="Feed filters">
        <div className="filter-group research-ebay-feed-filter-group">
          <label className="research-ebay-feed-filters-label" htmlFor="research-ebay-feed-min-price">
            Min. price
          </label>
          <select
            id="research-ebay-feed-min-price"
            className="filter-select research-ebay-feed-filter-select"
            value={minPriceGbp}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              setMinPriceGbp(v);
              setMaxPriceGbp((prev) => (prev < v ? v : prev));
            }}
            title="Minimum sold price in GBP"
          >
            {FEED_PRICE_OPTIONS.map((p) => (
              <option key={`min-${p}`} value={p}>
                £{p}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group research-ebay-feed-filter-group">
          <label className="research-ebay-feed-filters-label" htmlFor="research-ebay-feed-max-price">
            Max. price
          </label>
          <select
            id="research-ebay-feed-max-price"
            className="filter-select research-ebay-feed-filter-select"
            value={maxPriceGbp}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              setMaxPriceGbp(v);
              setMinPriceGbp((prev) => (prev > v ? v : prev));
            }}
            title="Maximum sold price in GBP"
          >
            {FEED_PRICE_OPTIONS.map((p) => (
              <option key={`max-${p}`} value={p}>
                £{p}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group view-group research-ebay-feed-filter-refresh">
          <button
            type="button"
            className="stock-refresh-icon-button"
            onClick={handleRefreshFeed}
            disabled={tags.length === 0 || feedLoading}
            title="Refresh feed"
            aria-label="Refresh feed"
          >
            ↻
          </button>
        </div>
      </div>

      {tagsError && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--error" role="alert">
          {tagsError}
        </div>
      )}

      <div className="research-ebay-feed-tags" aria-label="Saved feed tags">
        {tagsLoading && <span className="research-ebay-feed-muted">Loading tags…</span>}
        {tags.map((t, i) => (
          <span
            key={t.id}
            className={`research-ebay-feed-chip research-ebay-feed-chip--tone-${i % 6}`}
          >
            <span className="research-ebay-feed-chip-label" title={t.term}>
              {t.term}
            </span>
            <button
              type="button"
              className="research-ebay-feed-chip-remove"
              onClick={() => void handleRemove(t.id)}
              aria-label={`Remove tag ${t.term}`}
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

      {feedError && (
        <div className="research-ebay-feed-banner research-ebay-feed-banner--error" role="alert">
          {feedError}
        </div>
      )}

      {tags.length > 0 && feedLoading && items.length === 0 && (
        <div className="research-ebay-feed-grid" aria-busy="true" aria-label="Loading feed">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="research-ebay-feed-skeleton" />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="research-ebay-feed-grid">
          {items.map((it) => {
            const href = it.itemWebUrl || (it.itemId ? `https://www.ebay.co.uk/itm/${it.itemId}` : null);
            const inner = (
              <>
                <div className="research-ebay-feed-card-media">
                  {it.imageUrl ? (
                    <img src={it.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : null}
                </div>
                <div className="research-ebay-feed-card-body">
                  <div className="research-ebay-feed-card-tag">{it.tagTerm}</div>
                  <h3 className="research-ebay-feed-card-title">{it.title || 'Listing'}</h3>
                  <div className="research-ebay-feed-card-price">{it.priceLabel}</div>
                </div>
              </>
            );
            return (
              <article key={`${it.itemId}-${it.tagId}`} className="research-ebay-feed-card">
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

      {tags.length > 0 && !feedLoading && !feedError && items.length === 0 && (
        <p className="research-ebay-feed-muted">No sold listings matched these tags with the current filters.</p>
      )}

      {tags.length > 0 && items.length > 0 && (
        <div ref={sentinelRef} className="research-ebay-feed-sentinel" aria-hidden />
      )}

      {tags.length > 0 && items.length > 0 && feedLoading && (
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

export default ResearchEbayFeed;
