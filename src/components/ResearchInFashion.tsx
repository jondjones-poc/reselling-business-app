import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './Stock.css';
import './ResearchInFashion.css';

type FashionTag = { id: number; term: string; created_at?: string };

type TrendQuery = { query: string; value: string };

type FashionPhoto = {
  id: number;
  url: string;
  photographer: string;
  photographerUrl: string;
  width: number | null;
  height: number | null;
  imageUrl: string;
};

type FashionSection = {
  tagId: number;
  tagTerm: string;
  relatedQueries: TrendQuery[];
  risingQueries: TrendQuery[];
  photos: FashionPhoto[];
  trendsError: string | null;
  pexelsError: string | null;
  fetchedAt: string | null;
};

type FeedPhoto = FashionPhoto & {
  tagId: number;
  tagTerm: string;
  feedKey: string;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function interleaveFeedPhotos(sections: FashionSection[]): FeedPhoto[] {
  if (sections.length === 0) return [];
  const maxLen = Math.max(...sections.map((s) => s.photos.length), 0);
  const out: FeedPhoto[] = [];
  for (let i = 0; i < maxLen; i += 1) {
    for (const sec of sections) {
      const photo = sec.photos[i];
      if (!photo) continue;
      out.push({
        ...photo,
        tagId: sec.tagId,
        tagTerm: sec.tagTerm,
        feedKey: `${sec.tagId}-${photo.id}`,
      });
    }
  }
  return out;
}

function parseTrendQuerySortScore(raw: string): number {
  const value = String(raw ?? '').trim();
  if (!value) return 0;
  if (/^breakout$/i.test(value)) return 1_000_000;
  const pct = value.match(/^\+?([\d,.]+)\s*%$/);
  if (pct) {
    const n = Number(pct[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function mergeAndSortTrendQueries(sections: FashionSection[]): TrendQuery[] {
  const byQuery = new Map<string, TrendQuery>();
  for (const sec of sections) {
    for (const q of [...sec.relatedQueries, ...sec.risingQueries]) {
      const key = q.query.trim().toLowerCase();
      if (!key) continue;
      const existing = byQuery.get(key);
      if (!existing || parseTrendQuerySortScore(q.value) > parseTrendQuerySortScore(existing.value)) {
        byQuery.set(key, q);
      }
    }
  }
  return Array.from(byQuery.values()).sort(
    (a, b) => parseTrendQuerySortScore(b.value) - parseTrendQuerySortScore(a.value)
  );
}

function collectSectionWarnings(sections: FashionSection[]): string[] {
  const lines: string[] = [];
  for (const sec of sections) {
    if (sec.trendsError) lines.push(`${sec.tagTerm} (trends): ${sec.trendsError}`);
    if (sec.pexelsError) lines.push(`${sec.tagTerm} (photos): ${sec.pexelsError}`);
  }
  return lines;
}

const ResearchInFashion: React.FC = () => {
  const [tags, setTags] = useState<FashionTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [sections, setSections] = useState<FashionSection[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [pexelsConfigured, setPexelsConfigured] = useState(true);

  const feedPhotos = useMemo(() => interleaveFeedPhotos(sections), [sections]);
  const trendingQueries = useMemo(() => mergeAndSortTrendQueries(sections), [sections]);
  const sectionWarnings = useMemo(() => collectSectionWarnings(sections), [sections]);

  const tagToneById = useMemo(() => {
    const map = new Map<number, number>();
    tags.forEach((t, i) => map.set(t.id, i % 6));
    return map;
  }, [tags]);

  const loadTags = useCallback(async (): Promise<FashionTag[]> => {
    setTagsLoading(true);
    setTagsError(null);
    try {
      const res = await fetch(apiUrl('/api/research/in-fashion/tags'));
      const data = await readJson<{ rows?: FashionTag[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setTags(rows);
      return rows;
    } catch (e) {
      setTagsError(e instanceof Error ? e.message : 'Could not load tags');
      setTags([]);
      return [];
    } finally {
      setTagsLoading(false);
    }
  }, []);

  const loadInsights = useCallback(
    async (options?: { refresh?: boolean; tagId?: number; tagCount?: number }) => {
      const activeCount = options?.tagCount ?? tags.length;
      if (activeCount === 0) {
        setSections([]);
        return;
      }
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const params = new URLSearchParams();
        if (options?.refresh) params.set('refresh', '1');
        if (options?.tagId != null) params.set('tagId', String(options.tagId));
        const q = params.toString();
        const res = await fetch(apiUrl(`/api/research/in-fashion/insights${q ? `?${q}` : ''}`));
        const data = await readJson<{
          sections?: FashionSection[];
          pexelsConfigured?: boolean;
          error?: string;
          details?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.details || data.error || res.statusText);
        }
        const next = Array.isArray(data.sections) ? data.sections : [];
        setPexelsConfigured(data.pexelsConfigured !== false);
        if (options?.tagId != null) {
          setSections((prev) => {
            const byId = new Map(prev.map((s) => [s.tagId, s]));
            for (const sec of next) {
              byId.set(sec.tagId, sec);
            }
            return tags.map((t) => byId.get(t.id)).filter(Boolean) as FashionSection[];
          });
        } else {
          setSections(next);
        }
      } catch (e) {
        setInsightsError(e instanceof Error ? e.message : 'Could not load insights');
        if (!options?.tagId) setSections([]);
      } finally {
        setInsightsLoading(false);
      }
    },
    [tags]
  );

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    if (tagsLoading) return;
    if (tags.length === 0) {
      setSections([]);
      return;
    }
    void loadInsights({ tagCount: tags.length });
  }, [tags, tagsLoading, loadInsights]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = newTag.trim();
    if (!term || addBusy) return;
    setAddBusy(true);
    setTagsError(null);
    try {
      const res = await fetch(apiUrl('/api/research/in-fashion/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term }),
      });
      const data = await readJson<{ row?: FashionTag; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (data.row) {
        setTags((prev) => {
          const without = prev.filter((t) => t.id !== data.row!.id);
          return [...without, data.row!].sort((a, b) => a.id - b.id);
        });
        void loadInsights({ tagId: data.row.id, refresh: true, tagCount: tags.length + 1 });
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
      const res = await fetch(apiUrl(`/api/research/in-fashion/tags/${id}`), { method: 'DELETE' });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setTags((prev) => prev.filter((t) => t.id !== id));
      setSections((prev) => prev.filter((s) => s.tagId !== id));
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : 'Could not remove tag');
    }
  };

  const handleRefreshAll = () => {
    if (tags.length === 0 || insightsLoading) return;
    void loadInsights({ refresh: true, tagCount: tags.length });
  };

  return (
    <div className="research-in-fashion">
      <form className="research-in-fashion-toolbar" onSubmit={handleAdd}>
        <input
          className="search-input research-in-fashion-toolbar-search"
          value={newTag}
          onChange={(ev) => setNewTag(ev.target.value)}
          placeholder="e.g. mens clothes, vintage toys, antiques"
          maxLength={120}
          aria-label="New in-fashion tag"
        />
        <button type="submit" className="new-entry-button" disabled={addBusy || !newTag.trim()}>
          {addBusy ? 'Adding…' : 'Add tag'}
        </button>
        <button
          type="button"
          className="stock-refresh-icon-button research-in-fashion-refresh-all"
          onClick={handleRefreshAll}
          disabled={tags.length === 0 || insightsLoading}
          title="Refresh all tags"
          aria-label="Refresh all tags"
        >
          ↻
        </button>
      </form>

      {!pexelsConfigured && (
        <div className="research-in-fashion-banner research-in-fashion-banner--warn" role="status">
          Pexels images are disabled — add <code>PEXELS_API_KEY</code> to your server <code>.env</code>{' '}
          (free at{' '}
          <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer">
            pexels.com/api
          </a>
          ).
        </div>
      )}

      {tagsError && (
        <div className="research-in-fashion-banner research-in-fashion-banner--error" role="alert">
          {tagsError}
        </div>
      )}

      <div className="research-in-fashion-tags" aria-label="Saved tags">
        {tagsLoading && <span className="research-in-fashion-muted">Loading tags…</span>}
        {tags.map((t, i) => (
          <span
            key={t.id}
            className={`research-in-fashion-chip research-in-fashion-chip--tone-${i % 6}`}
          >
            <span className="research-in-fashion-chip-label" title={t.term}>
              {t.term}
            </span>
            <button
              type="button"
              className="research-in-fashion-chip-remove"
              onClick={() => void handleRemove(t.id)}
              aria-label={`Remove tag ${t.term}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {insightsError && (
        <div className="research-in-fashion-banner research-in-fashion-banner--error" role="alert">
          {insightsError}
        </div>
      )}

      {tags.length === 0 && !tagsLoading && (
        <p className="research-in-fashion-muted">
          Add a tag above to see trending searches and inspiration photos.
        </p>
      )}

      {tags.length > 0 && insightsLoading && sections.length === 0 && (
        <div className="research-in-fashion-body">
          <div className="research-in-fashion-loading research-in-fashion-feed" aria-busy="true">
            Loading trends and photos…
          </div>
          <aside className="research-in-fashion-sidebar" aria-label="Trending searches" />
        </div>
      )}

      {tags.length > 0 && sections.length > 0 && (
        <>
          {sectionWarnings.length > 0 && (
            <div className="research-in-fashion-banner research-in-fashion-banner--warn" role="status">
              {sectionWarnings.join(' · ')}
            </div>
          )}

          <div className="research-in-fashion-body">
            <div className="research-in-fashion-feed" aria-label="Inspiration feed">
              {feedPhotos.length > 0 ? (
                <div className="research-in-fashion-photo-grid">
                  {feedPhotos.map((photo) => {
                    const tone = tagToneById.get(photo.tagId) ?? 0;
                    return (
                      <figure key={photo.feedKey} className="research-in-fashion-photo-card">
                        <a
                          href={photo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="research-in-fashion-photo-link"
                        >
                          <img
                            src={photo.imageUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={photo.width ?? undefined}
                            height={photo.height ?? undefined}
                          />
                          <span
                            className={`research-in-fashion-photo-tag research-in-fashion-photo-tag--tone-${tone}`}
                          >
                            {photo.tagTerm}
                          </span>
                        </a>
                        <figcaption className="research-in-fashion-photo-credit">
                          {photo.photographerUrl ? (
                            <a href={photo.photographerUrl} target="_blank" rel="noopener noreferrer">
                              {photo.photographer || 'Pexels'}
                            </a>
                          ) : (
                            photo.photographer || 'Pexels'
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              ) : (
                pexelsConfigured &&
                !insightsLoading && (
                  <p className="research-in-fashion-muted">No photos matched your tags.</p>
                )
              )}
            </div>

            <aside className="research-in-fashion-sidebar" aria-label="Trending searches">
              {trendingQueries.length > 0 ? (
                <ul className="research-in-fashion-query-list">
                  {trendingQueries.map((q) => (
                    <li key={q.query} className="research-in-fashion-query-chip">
                      <span className="research-in-fashion-query-text">{q.query}</span>
                      {q.value && (
                        <span className="research-in-fashion-query-value">{q.value}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="research-in-fashion-muted">No trending searches returned.</p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
};

export default ResearchInFashion;
