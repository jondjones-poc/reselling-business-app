import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './EbayNicheExplorer.css';

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
  departmentLabel?: string;
};

const NICHE_DAYS = 30;
const SUBCATEGORIES_SHOWN = 8;

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

const EbayNicheExplorer: React.FC<EbayNicheExplorerProps> = ({
  highlightCategoryId,
  departmentLabel,
}) => {
  const [cards, setCards] = useState<TaxonomyCard[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [scoresById, setScoresById] = useState<Map<string, NicheScoreRow>>(new Map());
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTaxonomyLoading(true);
      setTaxonomyError(null);
      try {
        const res = await fetch(apiUrl('/api/ebay/niches/taxonomy'));
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
    if (categoryIds.length === 0) return;
    setScoresLoading(true);
    setScoresError(null);
    try {
      const params = new URLSearchParams({
        categoryIds: categoryIds.join(','),
        days: String(NICHE_DAYS),
      });
      const res = await fetch(apiUrl(`/api/ebay/niches/scores?${params.toString()}`));
      const data = await readJson<{ rows?: NicheScoreRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to load sales data');
      const next = new Map<string, NicheScoreRow>();
      for (const row of data.rows ?? []) {
        next.set(String(row.categoryId), row);
      }
      setScoresById((prev) => {
        const merged = new Map(prev);
        next.forEach((v, k) => merged.set(k, v));
        return merged;
      });
    } catch (err) {
      setScoresError(err instanceof Error ? err.message : 'Failed to load sales data');
    } finally {
      setScoresLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cards.length === 0) return;
    const ids = new Set<string>();
    for (const card of visibleCards) {
      for (const sub of card.subcategories.slice(0, SUBCATEGORIES_SHOWN)) {
        ids.add(sub.id);
      }
    }
    const missing = Array.from(ids).filter((id) => !scoresById.has(id));
    if (missing.length === 0) return;
    void loadScores(missing);
  }, [cards, visibleCards, scoresById, loadScores]);

  useEffect(() => {
    if (highlightCategoryId && cards.some((c) => c.id === highlightCategoryId)) {
      setFilterCategoryId(highlightCategoryId);
    }
  }, [highlightCategoryId, cards]);

  const formatSold = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toLocaleString('en-GB');
  };

  return (
    <div className="ebay-niche-explorer">
      <header className="ebay-niche-explorer-header">
        <div>
          <h2 className="ebay-niche-explorer-title">Explore eBay niches</h2>
          <p className="ebay-niche-explorer-subtitle">
            Star ratings rank sub-categories by sold volume in the last {NICHE_DAYS} days on eBay UK
            {departmentLabel ? ` · ${departmentLabel} highlighted` : ''}.
          </p>
        </div>
        <div className="ebay-niche-explorer-filter">
          <label htmlFor="ebay-niche-category-filter" className="ebay-niche-explorer-filter-label">
            eBay category
          </label>
          <select
            id="ebay-niche-category-filter"
            className="ebay-niche-explorer-filter-select"
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value)}
            disabled={taxonomyLoading || cards.length === 0}
          >
            <option value="all">All top-level categories</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </header>

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
            const subs = card.subcategories.slice(0, SUBCATEGORIES_SHOWN);
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
                      const stars = score != null ? score.stars : 0;
                      return (
                        <li key={sub.id} className="ebay-niche-card-row">
                          <span className="ebay-niche-card-row-name" title={sub.name}>
                            {sub.name}
                          </span>
                          <span className="ebay-niche-card-row-meta">
                            <StarRating stars={stars} />
                            <span className="ebay-niche-sold-count" title="Sold (30 days)">
                              {formatSold(score?.soldCount)}
                            </span>
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
                {card.subcategories.length > SUBCATEGORIES_SHOWN ? (
                  <button
                    type="button"
                    className="ebay-niche-card-more"
                    onClick={() => setFilterCategoryId(card.id)}
                  >
                    More
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EbayNicheExplorer;
