import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiBase';
import './EbayNicheExplorer.css';
import './ResearchEbayFeed.css';

type TaxonomyCard = {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
};

type NicheScoreRow = {
  categoryId: string;
  activeCount: number | null;
  soldCount: number | null;
  sellThroughRatio: number | null;
  stars: number;
  error?: string;
};

type EbayNicheExplorerProps = {
  /** Highlight eBay top-level card matching the selected business department. */
  highlightCategoryId?: string | null;
};

const NICHE_DAYS = 30;
const SUBCATEGORIES_SHOWN = 8;
const TOP_BUY_TICKER_COUNT = 8;
/** Must match server limit in GET /api/ebay/niches/scores */
const SCORE_BATCH_SIZE = 40;

type TopBuyTickerItem = {
  id: string;
  name: string;
  parentName: string;
  soldCount: number;
  stars: number;
};

type SelectedSubcategory = {
  id: string;
  name: string;
  parentName: string;
};

type CategoryInsightSeller = {
  username: string;
  soldListingCount: number;
};

type CategoryInsightItem = {
  itemId: string | null;
  title: string;
  imageUrl: string | null;
  priceLabel: string;
  itemWebUrl: string | null;
  categoryId: string;
  categoryName: string;
  sellerUsername: string;
  soldAtMs?: number;
};

function ebayUkSellerProfileUrl(username: string): string {
  return `https://www.ebay.co.uk/usr/${encodeURIComponent(username.trim())}`;
}

function formatSoldDate(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function soldCountToStars(soldCount: number | null | undefined, peerSoldCounts: number[]): number {
  if (soldCount == null || !Number.isFinite(soldCount) || soldCount <= 0) return 0;
  const peers = peerSoldCounts.filter((n) => Number.isFinite(n) && n > 0);
  const max = peers.length > 0 ? Math.max(...peers) : soldCount;
  const ratio = soldCount / Math.max(max, 1);
  if (ratio >= 0.75) return 5;
  if (ratio >= 0.5) return 4;
  if (ratio >= 0.3) return 3;
  if (ratio >= 0.12) return 2;
  return 1;
}

function sortSubcategoriesByPopularity(
  subs: { id: string; name: string }[],
  scoresById: Map<string, NicheScoreRow>
): { id: string; name: string }[] {
  const peerSold = subs.map((s) => scoresById.get(s.id)?.soldCount ?? 0);
  return [...subs].sort((a, b) => {
    const soldA = scoresById.get(a.id)?.soldCount;
    const soldB = scoresById.get(b.id)?.soldCount;
    const starsA = soldCountToStars(soldA, peerSold);
    const starsB = soldCountToStars(soldB, peerSold);
    if (starsB !== starsA) return starsB - starsA;
    const numA = soldA != null && Number.isFinite(soldA) ? soldA : -1;
    const numB = soldB != null && Number.isFinite(soldB) ? soldB : -1;
    return numB - numA;
  });
}

function StarRating({ stars }: { stars: number }) {
  return (
    <span className="ebay-niche-stars" aria-label={`${stars} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`ebay-niche-star${i < stars ? ' ebay-niche-star--on' : ''}`}
          aria-hidden
        >
          ★
        </span>
      ))}
    </span>
  );
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

const EbayNicheExplorer: React.FC<EbayNicheExplorerProps> = ({ highlightCategoryId }) => {
  const [cards, setCards] = useState<TaxonomyCard[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [scoresById, setScoresById] = useState<Map<string, NicheScoreRow>>(new Map());
  const scoresByIdRef = useRef(scoresById);
  scoresByIdRef.current = scoresById;
  const scoresInFlightRef = useRef<Set<string>>(new Set());
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');
  const [selectedSub, setSelectedSub] = useState<SelectedSubcategory | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightSellers, setInsightSellers] = useState<CategoryInsightSeller[]>([]);
  const [insightItems, setInsightItems] = useState<CategoryInsightItem[]>([]);
  const [insightSampleSize, setInsightSampleSize] = useState<number | null>(null);
  const insightPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTaxonomyLoading(true);
      setTaxonomyError(null);
      try {
        const res = await apiFetch('/api/ebay/niches/taxonomy');
        const data = await readJson<{ cards?: TaxonomyCard[]; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load eBay categories');
        if (!cancelled) setCards(Array.isArray(data.cards) ? data.cards : []);
      } catch (err) {
        if (!cancelled) {
          setCards([]);
          setTaxonomyError(err instanceof Error ? err.message : 'Failed to load eBay categories');
        }
      } finally {
        if (!cancelled) setTaxonomyLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCards = useMemo(() => {
    if (filterCategoryId === 'all') return cards;
    return cards.filter((c) => c.id === filterCategoryId);
  }, [cards, filterCategoryId]);

  const loadScores = useCallback(async (categoryIds: string[]) => {
    const toFetch = categoryIds.filter(
      (id) => !scoresByIdRef.current.has(id) && !scoresInFlightRef.current.has(id)
    );
    if (toFetch.length === 0) return;

    for (const id of toFetch) {
      scoresInFlightRef.current.add(id);
    }
    setScoresLoading(true);
    setScoresError(null);

    try {
      for (let offset = 0; offset < toFetch.length; offset += SCORE_BATCH_SIZE) {
        const chunk = toFetch.slice(offset, offset + SCORE_BATCH_SIZE);
        const params = new URLSearchParams({
          categoryIds: chunk.join(','),
          days: String(NICHE_DAYS),
        });
        const res = await apiFetch(`/api/ebay/niches/scores?${params.toString()}`);
        const data = await readJson<{ rows?: NicheScoreRow[]; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || 'Failed to load sales data');
        setScoresById((prev) => {
          const merged = new Map(prev);
          for (const row of data.rows ?? []) {
            merged.set(String(row.categoryId), row);
          }
          return merged;
        });
      }
    } catch (err) {
      setScoresError(err instanceof Error ? err.message : 'Failed to load sales data');
    } finally {
      for (const id of toFetch) {
        scoresInFlightRef.current.delete(id);
      }
      setScoresLoading(false);
    }
  }, []);

  const visibleSubcategoryIds = useMemo(() => {
    const ids: string[] = [];
    for (const card of visibleCards) {
      for (const sub of card.subcategories) {
        ids.push(sub.id);
      }
    }
    return ids;
  }, [visibleCards]);

  useEffect(() => {
    if (cards.length === 0 || visibleSubcategoryIds.length === 0) return;
    const missing = visibleSubcategoryIds.filter(
      (id) => !scoresByIdRef.current.has(id) && !scoresInFlightRef.current.has(id)
    );
    if (missing.length === 0) return;
    void loadScores(missing);
  }, [cards, visibleSubcategoryIds, loadScores]);

  const loadCategoryInsight = useCallback(async (sub: SelectedSubcategory) => {
    setInsightLoading(true);
    setInsightError(null);
    setInsightSellers([]);
    setInsightItems([]);
    setInsightSampleSize(null);
    try {
      const params = new URLSearchParams({
        categoryId: sub.id,
        name: sub.name,
        days: String(NICHE_DAYS),
      });
      const res = await apiFetch(`/api/ebay/niches/category-insight?${params.toString()}`);
      const data = await readJson<{
        topSellers?: CategoryInsightSeller[];
        items?: CategoryInsightItem[];
        sampleSize?: number;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to load category sellers');
      setInsightSellers(Array.isArray(data.topSellers) ? data.topSellers : []);
      setInsightItems(Array.isArray(data.items) ? data.items : []);
      setInsightSampleSize(typeof data.sampleSize === 'number' ? data.sampleSize : null);
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : 'Failed to load category sellers');
    } finally {
      setInsightLoading(false);
    }
  }, []);

  const handleSubcategoryClick = useCallback(
    (sub: { id: string; name: string }, parentName: string) => {
      const next: SelectedSubcategory = { id: sub.id, name: sub.name, parentName };
      setSelectedSub(next);
      void loadCategoryInsight(next);
      window.setTimeout(() => {
        insightPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
    },
    [loadCategoryInsight]
  );

  const formatSold = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString('en-GB');
  };

  const topBuyTickerItems = useMemo((): TopBuyTickerItem[] => {
    const rows: TopBuyTickerItem[] = [];
    for (const card of visibleCards) {
      const sortedSubs = sortSubcategoriesByPopularity(card.subcategories, scoresById);
      const peerSold = card.subcategories.map((s) => scoresById.get(s.id)?.soldCount ?? 0);
      for (const sub of sortedSubs) {
        const score = scoresById.get(sub.id);
        const sold = score?.soldCount;
        if (sold == null || !Number.isFinite(sold) || sold <= 0) continue;
        rows.push({
          id: sub.id,
          name: sub.name,
          parentName: card.name,
          soldCount: sold,
          stars: soldCountToStars(sold, peerSold),
        });
      }
    }
    return rows
      .sort(
        (a, b) =>
          b.soldCount - a.soldCount ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      .slice(0, TOP_BUY_TICKER_COUNT);
  }, [visibleCards, scoresById]);

  const renderTickerChip = (item: TopBuyTickerItem) => (
    <span key={item.id} className="ebay-niche-buy-ticker-chip" title={`${item.parentName} · ${item.name}`}>
      <span className="ebay-niche-buy-ticker-chip-parent">{item.parentName}</span>
      <span className="ebay-niche-buy-ticker-chip-sep" aria-hidden>
        ·
      </span>
      <span className="ebay-niche-buy-ticker-chip-name">{item.name}</span>
      <StarRating stars={item.stars} />
      <span className="ebay-niche-buy-ticker-chip-sold">{formatSold(item.soldCount)} sold</span>
    </span>
  );

  return (
    <div className="ebay-niche-explorer">
      <div className="ebay-niche-explorer-toolbar">
        <span className="ebay-niche-info-wrap">
          <button
            type="button"
            className="ebay-niche-info-btn"
            aria-label="How star ratings are calculated"
            aria-describedby="ebay-niche-info-tooltip"
          >
            <svg
              className="ebay-niche-info-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
          <span id="ebay-niche-info-tooltip" className="ebay-niche-info-tooltip" role="tooltip">
            <strong>Star ratings</strong> rank each sub-category against the others in the same card by{' '}
            <strong>eBay UK sold volume</strong> in the last {NICHE_DAYS} days (Browse API, category name +
            category ID). The number beside the stars is that sold count. Within a card:{' '}
            <strong>5★</strong> ≈ top seller (≥75% of the highest), <strong>4★</strong> ≥50%,{' '}
            <strong>3★</strong> ≥30%, <strong>2★</strong> ≥12%, <strong>1★</strong> has sales but below that,{' '}
            <strong>0★</strong> no sold listings in the period.
          </span>
        </span>

        <select
          id="ebay-niche-category-filter"
          className="ebay-niche-explorer-filter-select"
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
          disabled={taxonomyLoading || cards.length === 0}
          aria-label="eBay category filter"
        >
          <option value="all">All Categories</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <span className="ebay-niche-toolbar-spacer" aria-hidden />
      </div>

      {!taxonomyLoading && !taxonomyError ? (
        <div
          className="ebay-niche-buy-ticker"
          role="region"
          aria-label="Top categories to buy on eBay"
        >
          <span className="ebay-niche-buy-ticker-heading">Top {TOP_BUY_TICKER_COUNT} to buy</span>
          {topBuyTickerItems.length === 0 ? (
            <p className="ebay-niche-buy-ticker-empty">
              {scoresLoading ? 'Loading top picks…' : 'No sold data yet for this view.'}
            </p>
          ) : (
            <div className="ebay-niche-buy-ticker-viewport">
              <div
                className={`ebay-niche-buy-ticker-track${topBuyTickerItems.length >= 3 ? ' ebay-niche-buy-ticker-track--animate' : ''}`}
              >
                <div className="ebay-niche-buy-ticker-segment" aria-hidden={false}>
                  {topBuyTickerItems.map(renderTickerChip)}
                </div>
                {topBuyTickerItems.length >= 3 ? (
                  <div className="ebay-niche-buy-ticker-segment" aria-hidden>
                    {topBuyTickerItems.map((item) =>
                      renderTickerChip({ ...item, id: `${item.id}-dup` })
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {taxonomyError && (
        <div className="ebay-niche-explorer-error" role="alert">
          {taxonomyError}
        </div>
      )}
      {scoresError && (
        <div className="ebay-niche-explorer-error ebay-niche-explorer-error--inline" role="alert">
          {scoresError}
        </div>
      )}
      {taxonomyLoading && <p className="ebay-niche-explorer-muted">Loading eBay category tree…</p>}
      {scoresLoading && !taxonomyLoading && (
        <p className="ebay-niche-explorer-muted">Loading sold data from eBay…</p>
      )}

      {!taxonomyLoading && !taxonomyError && (
        <div className="ebay-niche-card-grid">
          {visibleCards.map((card) => {
            const highlighted = highlightCategoryId != null && card.id === highlightCategoryId;
            const sortedSubs = sortSubcategoriesByPopularity(card.subcategories, scoresById);
            const showAllSubs = filterCategoryId !== 'all' && filterCategoryId === card.id;
            const subs = showAllSubs
              ? sortedSubs
              : sortedSubs.slice(0, SUBCATEGORIES_SHOWN);
            const peerSold = card.subcategories.map((s) => scoresById.get(s.id)?.soldCount ?? 0);
            return (
              <article
                key={card.id}
                className={`ebay-niche-card${highlighted ? ' ebay-niche-card--highlight' : ''}`}
              >
                <h3 className="ebay-niche-card-title">{card.name}</h3>
                <ul className="ebay-niche-card-list">
                  {subs.length === 0 ? (
                    <li className="ebay-niche-card-row ebay-niche-card-row--empty">No sub-categories</li>
                  ) : (
                    subs.map((sub) => {
                      const score = scoresById.get(sub.id);
                      const stars = soldCountToStars(score?.soldCount, peerSold);
                      return (
                        <li key={sub.id}>
                          <button
                            type="button"
                            className={`ebay-niche-card-row ebay-niche-card-row--clickable${selectedSub?.id === sub.id ? ' ebay-niche-card-row--selected' : ''}`}
                            onClick={() => handleSubcategoryClick(sub, card.name)}
                            title={`Top sellers in ${sub.name}`}
                          >
                            <span className="ebay-niche-card-row-name">{sub.name}</span>
                            <span className="ebay-niche-card-row-stars">
                              <StarRating stars={stars} />
                            </span>
                            <span className="ebay-niche-sold-count" title="Sold (30 days)">
                              {formatSold(score?.soldCount)}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
                {!showAllSubs && sortedSubs.length > SUBCATEGORIES_SHOWN ? (
                  <button
                    type="button"
                    className="ebay-niche-card-more"
                    onClick={() => setFilterCategoryId(card.id)}
                  >
                    More ({sortedSubs.length - SUBCATEGORIES_SHOWN} more)
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {selectedSub ? (
        <section
          ref={insightPanelRef}
          className="ebay-niche-category-insight"
          aria-label={`Top sellers in ${selectedSub.name}`}
        >
          <div className="ebay-niche-category-insight-header">
            <div>
              <p className="ebay-niche-category-insight-eyebrow">{selectedSub.parentName}</p>
              <h3 className="ebay-niche-category-insight-title">{selectedSub.name}</h3>
              <p className="ebay-niche-category-insight-meta">
                Top {NICHE_DAYS}-day sellers from eBay sold listings in this category
                {insightSampleSize != null ? ` (sampled ${insightSampleSize.toLocaleString('en-GB')})` : ''}
              </p>
            </div>
            <button
              type="button"
              className="ebay-niche-category-insight-close"
              onClick={() => setSelectedSub(null)}
              aria-label="Close category sellers"
            >
              ×
            </button>
          </div>

          {insightError ? (
            <div className="ebay-niche-explorer-error" role="alert">
              {insightError}
            </div>
          ) : null}

          {insightLoading ? (
            <p className="ebay-niche-explorer-muted">Finding top sellers…</p>
          ) : (
            <>
              {insightSellers.length > 0 ? (
                <div className="ebay-niche-category-insight-sellers" aria-label="Top sellers">
                  {insightSellers.map((s, i) => (
                    <a
                      key={s.username}
                      href={ebayUkSellerProfileUrl(s.username)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`research-ebay-feed-chip research-ebay-feed-chip--tone-${i % 6}`}
                      title={`${s.soldListingCount} sold listings in sample`}
                    >
                      @{s.username}
                      <span className="ebay-niche-category-insight-seller-count">
                        {s.soldListingCount}
                      </span>
                    </a>
                  ))}
                </div>
              ) : !insightError ? (
                <p className="ebay-niche-explorer-muted">No seller data in the recent sold sample.</p>
              ) : null}

              {insightItems.length > 0 ? (
                <div className="research-ebay-feed-grid ebay-niche-category-insight-grid">
                  {insightItems.map((it) => {
                    const href =
                      it.itemWebUrl || (it.itemId ? `https://www.ebay.co.uk/itm/${it.itemId}` : null);
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
                          <h4 className="research-ebay-feed-card-title">{it.title || 'Listing'}</h4>
                          <div className="research-ebay-feed-card-price">{it.priceLabel}</div>
                          {soldDate ? (
                            <div className="ebay-niche-category-insight-sold-date">Sold {soldDate}</div>
                          ) : null}
                        </div>
                      </>
                    );
                    return (
                      <article key={`${it.itemId}-${it.sellerUsername}`} className="research-ebay-feed-card">
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
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
};

export default EbayNicheExplorer;
