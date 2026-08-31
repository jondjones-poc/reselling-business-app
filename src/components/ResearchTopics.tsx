import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiUrl } from '../utils/apiBase';
import ResearchEbayFeed from './ResearchEbayFeed';
import {
  buildResearchTopicPrompt,
  extractJsonPayload,
  RESEARCH_TOPIC_JSON_SHAPE
} from './researchTopicPrompt';
import './Stock.css';
import './ResearchTopics.css';

type TopicStatus = 'researching' | 'ready' | 'buying' | 'parked';
type BrandTier = 'premium' | 'mid' | 'budget' | 'avoid';
type ItemVerdict = 'buy' | 'maybe' | 'avoid' | 'unknown';

type Topic = {
  id: number;
  name: string;
  status: TopicStatus;
  summary: string | null;
  seasonality: string | null;
  myNotes: string | null;
  tagCount?: number;
  brandCount?: number;
  itemCount?: number;
  lastImportAt?: string | null;
};

type TopicTag = { id: number; term: string };

type TopicBrand = {
  id: number;
  name: string;
  tier: BrandTier;
  resaleLowGbp: number | null;
  resaleHighGbp: number | null;
  buyMaxGbp: number | null;
  models: string[];
  notes: string | null;
};

type TopicItem = {
  id: number;
  name: string;
  brandName: string | null;
  whatToLookFor: string | null;
  redFlags: string | null;
  howToIdentify: string | null;
  valueLowGbp: number | null;
  valueHighGbp: number | null;
  verdict: ItemVerdict;
  myNotes: string | null;
};

type TopicDetail = {
  topic: Topic;
  tags: TopicTag[];
  brands: TopicBrand[];
  items: TopicItem[];
  imports: { id: number; summary: string | null; created_at: string }[];
};

type DetailTab = 'overview' | 'brands' | 'items' | 'feed' | 'import';

const STATUS_LABELS: Record<TopicStatus, string> = {
  researching: 'Researching',
  ready: 'Ready',
  buying: 'Buying',
  parked: 'Parked'
};

const TIER_LABELS: Record<BrandTier, string> = {
  premium: 'Premium',
  mid: 'Mid',
  budget: 'Budget',
  avoid: 'Avoid'
};

const VERDICT_LABELS: Record<ItemVerdict, string> = {
  buy: 'Buy',
  maybe: 'Maybe',
  avoid: 'Avoid',
  unknown: 'Not decided'
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init
  });
  const data = await readJson<T & { error?: string; details?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || data.details || res.statusText);
  }
  return data;
}

function gbp(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0
  }).format(value);
}

function priceBand(low: number | null, high: number | null): string {
  if (low == null && high == null) return '—';
  if (low != null && high != null) return `${gbp(low)} – ${gbp(high)}`;
  return gbp(low ?? high);
}

const ResearchTopics: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const topicIdParam = Number(searchParams.get('topic'));
  const activeTopicId = Number.isFinite(topicIdParam) && topicIdParam > 0 ? topicIdParam : null;
  const detailTab = (searchParams.get('pane') as DetailTab) || 'overview';

  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const data = await callApi<{ rows: Topic[] }>('/api/research/topics');
      setTopics(data.rows ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load topics');
    } finally {
      setTopicsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await callApi<TopicDetail>(`/api/research/topics/${id}`);
      setDetail(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load topic');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  useEffect(() => {
    if (activeTopicId == null) {
      setDetail(null);
      return;
    }
    void loadDetail(activeTopicId);
  }, [activeTopicId, loadDetail]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const openTopic = (id: number | null, pane: DetailTab = 'overview') => {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'topics');
    if (id == null) {
      next.delete('topic');
      next.delete('pane');
    } else {
      next.set('topic', String(id));
      next.set('pane', pane);
    }
    setSearchParams(next);
  };

  const handleAddTopic = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newTopic.trim();
    if (!name) return;
    setBusy(true);
    try {
      const data = await callApi<{ row: Topic }>('/api/research/topics', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      setNewTopic('');
      await loadTopics();
      openTopic(data.row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create topic');
    } finally {
      setBusy(false);
    }
  };

  if (activeTopicId == null) {
    return (
      <section className="research-topics">
        <header className="research-topics-head">
          <div>
            <h2 className="research-topics-title">Topics</h2>
            <p className="research-topics-sub">
              Research a category before the season starts — wetsuits, cameras, golf clubs — then
              carry the brands, prices and red flags with you.
            </p>
          </div>
        </header>

        {error ? (
          <div className="research-topics-banner research-topics-banner--error" role="alert">
            {error}
          </div>
        ) : null}

        <form className="research-topics-add" onSubmit={handleAddTopic}>
          <input
            className="search-input"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="New topic — e.g. Wetsuits"
            maxLength={120}
            disabled={busy}
          />
          <button type="submit" className="new-entry-button" disabled={busy || !newTopic.trim()}>
            {busy ? 'Adding…' : '+ Add topic'}
          </button>
        </form>

        {topicsLoading ? <p className="research-topics-muted">Loading topics…</p> : null}

        {!topicsLoading && topics.length === 0 ? (
          <p className="research-topics-muted">
            No topics yet. Add one above, then use “Copy ChatGPT prompt” to fill it in.
          </p>
        ) : null}

        <div className="research-topics-grid">
          {topics.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className="research-topics-card"
              onClick={() => openTopic(topic.id)}
            >
              <div className="research-topics-card-head">
                <span className="research-topics-card-name">{topic.name}</span>
                <span className={`research-topics-status research-topics-status--${topic.status}`}>
                  {STATUS_LABELS[topic.status]}
                </span>
              </div>
              {topic.summary ? (
                <p className="research-topics-card-summary">{topic.summary}</p>
              ) : (
                <p className="research-topics-card-summary research-topics-muted">
                  No research imported yet.
                </p>
              )}
              <div className="research-topics-card-stats">
                <span>{topic.brandCount ?? 0} brands</span>
                <span>{topic.itemCount ?? 0} items</span>
                <span>{topic.tagCount ?? 0} tags</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    );
  }

  const topic = detail?.topic;

  return (
    <section className="research-topics">
      <header className="research-topics-head">
        <div>
          <button type="button" className="research-topics-back" onClick={() => openTopic(null)}>
            ← All topics
          </button>
          <h2 className="research-topics-title">{topic?.name ?? 'Topic'}</h2>
        </div>
      </header>

      {error ? (
        <div className="research-topics-banner research-topics-banner--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="research-topics-banner research-topics-banner--ok" role="status">
          {notice}
        </div>
      ) : null}

      <nav className="research-topics-panes" role="tablist" aria-label="Topic sections">
        {(
          [
            ['overview', 'Overview'],
            ['brands', 'Brands & prices'],
            ['items', 'Items to learn'],
            ['feed', 'eBay feed'],
            ['import', 'Import research']
          ] as [DetailTab, string][]
        ).map(([pane, label]) => (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={detailTab === pane}
            className={`research-topics-pane-tab${detailTab === pane ? ' active' : ''}`}
            onClick={() => openTopic(activeTopicId, pane)}
          >
            {label}
          </button>
        ))}
      </nav>

      {detailLoading && !detail ? <p className="research-topics-muted">Loading…</p> : null}

      {detail && topic ? (
        <>
          {detailTab === 'overview' ? (
            <TopicOverview
              topic={topic}
              tags={detail.tags}
              onSaved={async (message) => {
                setNotice(message);
                await loadDetail(topic.id);
                await loadTopics();
              }}
              onError={setError}
            />
          ) : null}

          {detailTab === 'brands' ? (
            <TopicBrands
              brands={detail.brands}
              onChanged={async () => {
                await loadDetail(topic.id);
              }}
              onError={setError}
            />
          ) : null}

          {detailTab === 'items' ? (
            <TopicItems
              items={detail.items}
              onChanged={async () => {
                await loadDetail(topic.id);
              }}
              onError={setError}
            />
          ) : null}

          {detailTab === 'feed' ? (
            detail.tags.length === 0 ? (
              <p className="research-topics-muted">
                Add search tags on the Overview tab (or import research) to fill this feed.
              </p>
            ) : (
              <ResearchEbayFeed topicId={topic.id} />
            )
          ) : null}

          {detailTab === 'import' ? (
            <TopicImport
              topicName={topic.name}
              imports={detail.imports}
              topicId={topic.id}
              onImported={async (message) => {
                setNotice(message);
                await loadDetail(topic.id);
                await loadTopics();
              }}
              onError={setError}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
};

const TopicOverview: React.FC<{
  topic: Topic;
  tags: TopicTag[];
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}> = ({ topic, tags, onSaved, onError }) => {
  const [status, setStatus] = useState<TopicStatus>(topic.status);
  const [myNotes, setMyNotes] = useState(topic.myNotes ?? '');
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(topic.status);
    setMyNotes(topic.myNotes ?? '');
  }, [topic.id, topic.status, topic.myNotes]);

  const dirty = status !== topic.status || myNotes !== (topic.myNotes ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await callApi(`/api/research/topics/${topic.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, myNotes })
      });
      await onSaved('Topic saved.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save topic');
    } finally {
      setSaving(false);
    }
  };

  const addTag = async (event: React.FormEvent) => {
    event.preventDefault();
    const term = newTag.trim();
    if (!term) return;
    try {
      await callApi(`/api/research/topics/${topic.id}/tags`, {
        method: 'POST',
        body: JSON.stringify({ term })
      });
      setNewTag('');
      await onSaved('Tag added.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add tag');
    }
  };

  const removeTag = async (tagId: number) => {
    try {
      await callApi(`/api/research/topic-tags/${tagId}`, { method: 'DELETE' });
      await onSaved('Tag removed.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove tag');
    }
  };

  return (
    <div className="research-topics-overview">
      <div className="research-topics-panel">
        <h3>Summary</h3>
        <p className={topic.summary ? '' : 'research-topics-muted'}>
          {topic.summary ?? 'Import research to fill this in.'}
        </p>
        {topic.seasonality ? (
          <>
            <h3>Seasonality</h3>
            <p>{topic.seasonality}</p>
          </>
        ) : null}
      </div>

      <div className="research-topics-panel">
        <h3>Search tags</h3>
        <p className="research-topics-muted">
          Used by this topic&apos;s eBay feed, so you see wetsuits rather than everything.
        </p>
        <div className="research-topics-chips">
          {tags.map((tag, i) => (
            <span key={tag.id} className={`research-topics-chip research-topics-chip--tone-${i % 6}`}>
              <span>{tag.term}</span>
              <button
                type="button"
                onClick={() => void removeTag(tag.id)}
                aria-label={`Remove tag ${tag.term}`}
              >
                ×
              </button>
            </span>
          ))}
          {tags.length === 0 ? <span className="research-topics-muted">No tags yet.</span> : null}
        </div>
        <form className="research-topics-add" onSubmit={addTag}>
          <input
            className="search-input"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add a search tag"
            maxLength={120}
          />
          <button type="submit" className="new-entry-button" disabled={!newTag.trim()}>
            + Add
          </button>
        </form>
      </div>

      <div className="research-topics-panel">
        <h3>My notes</h3>
        <p className="research-topics-muted">
          Yours alone — re-importing research never overwrites this.
        </p>
        <textarea
          className="research-topics-textarea"
          value={myNotes}
          onChange={(e) => setMyNotes(e.target.value)}
          rows={8}
          placeholder="What you've learned, sellers to revisit, prices you actually paid…"
        />
        <div className="research-topics-row">
          <label className="research-topics-field">
            <span>Status</span>
            <select
              className="filter-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as TopicStatus)}
            >
              {(Object.keys(STATUS_LABELS) as TopicStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="new-entry-button"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TopicBrands: React.FC<{
  brands: TopicBrand[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ brands, onChanged, onError }) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [buyMaxDraft, setBuyMaxDraft] = useState('');

  const totals = useMemo(
    () => ({
      premium: brands.filter((b) => b.tier === 'premium').length,
      avoid: brands.filter((b) => b.tier === 'avoid').length
    }),
    [brands]
  );

  const saveBuyMax = async (brand: TopicBrand) => {
    try {
      await callApi(`/api/research/topic-brands/${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ buyMaxGbp: buyMaxDraft === '' ? null : Number(buyMaxDraft) })
      });
      setEditingId(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update brand');
    }
  };

  if (brands.length === 0) {
    return (
      <p className="research-topics-muted">
        No brands yet. Use the Import research tab to paste a ChatGPT answer.
      </p>
    );
  }

  return (
    <div className="research-topics-panel">
      <p className="research-topics-muted">
        {brands.length} brands · {totals.premium} premium · {totals.avoid} to avoid. “Buy max” is the
        most to pay in the field — tap it to adjust once you know better.
      </p>
      <div className="research-topics-table-wrap">
        <table className="research-topics-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Tier</th>
              <th className="num">Resale band</th>
              <th className="num">Buy max</th>
              <th>Models to look for</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => (
              <tr key={brand.id} className={brand.tier === 'avoid' ? 'is-avoid' : undefined}>
                <td>
                  <strong>{brand.name}</strong>
                  {brand.notes ? <div className="research-topics-cell-note">{brand.notes}</div> : null}
                </td>
                <td>
                  <span className={`research-topics-tier research-topics-tier--${brand.tier}`}>
                    {TIER_LABELS[brand.tier]}
                  </span>
                </td>
                <td className="num">{priceBand(brand.resaleLowGbp, brand.resaleHighGbp)}</td>
                <td className="num">
                  {editingId === brand.id ? (
                    <span className="research-topics-inline-edit">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={buyMaxDraft}
                        onChange={(e) => setBuyMaxDraft(e.target.value)}
                        autoFocus
                      />
                      <button type="button" onClick={() => void saveBuyMax(brand)}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="research-topics-buymax"
                      onClick={() => {
                        setEditingId(brand.id);
                        setBuyMaxDraft(brand.buyMaxGbp != null ? String(brand.buyMaxGbp) : '');
                      }}
                    >
                      {gbp(brand.buyMaxGbp)}
                    </button>
                  )}
                </td>
                <td>
                  {brand.models.length > 0 ? (
                    brand.models.join(', ')
                  ) : (
                    <span className="research-topics-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TopicItems: React.FC<{
  items: TopicItem[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}> = ({ items, onChanged, onError }) => {
  const [openId, setOpenId] = useState<number | null>(items[0]?.id ?? null);
  const [notesDraft, setNotesDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = items.find((i) => i.id === openId) ?? null;

  useEffect(() => {
    setNotesDraft(selected?.myNotes ?? '');
  }, [selected?.id, selected?.myNotes]);

  if (items.length === 0) {
    return (
      <p className="research-topics-muted">
        No items yet. Import research to get a list of models worth learning.
      </p>
    );
  }

  const saveItem = async (verdict?: ItemVerdict) => {
    if (!selected) return;
    setSaving(true);
    try {
      await callApi(`/api/research/topic-items/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          myNotes: notesDraft,
          ...(verdict ? { verdict } : {})
        })
      });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="research-topics-items">
      <ul className="research-topics-item-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`research-topics-item-btn${item.id === openId ? ' active' : ''}`}
              onClick={() => setOpenId(item.id)}
            >
              <span className="research-topics-item-name">{item.name}</span>
              <span className={`research-topics-verdict research-topics-verdict--${item.verdict}`}>
                {VERDICT_LABELS[item.verdict]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="research-topics-panel research-topics-item-detail">
          <h3>{selected.name}</h3>
          <div className="research-topics-item-meta">
            {selected.brandName ? <span>{selected.brandName}</span> : null}
            <span>Worth {priceBand(selected.valueLowGbp, selected.valueHighGbp)}</span>
          </div>

          <h4>What to look for</h4>
          <p className={selected.whatToLookFor ? '' : 'research-topics-muted'}>
            {selected.whatToLookFor ?? '—'}
          </p>

          <h4>Red flags</h4>
          <p className={selected.redFlags ? '' : 'research-topics-muted'}>
            {selected.redFlags ?? '—'}
          </p>

          <h4>How to identify it</h4>
          <p className={selected.howToIdentify ? '' : 'research-topics-muted'}>
            {selected.howToIdentify ?? '—'}
          </p>

          <h4>My thoughts</h4>
          <textarea
            className="research-topics-textarea"
            rows={6}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="What one looked like in the flesh, what you paid, what it sold for…"
          />

          <div className="research-topics-row">
            <div className="research-topics-verdict-picker">
              {(['buy', 'maybe', 'avoid'] as ItemVerdict[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`research-topics-verdict-btn${selected.verdict === v ? ' active' : ''}`}
                  onClick={() => void saveItem(v)}
                  disabled={saving}
                >
                  {VERDICT_LABELS[v]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="new-entry-button"
              onClick={() => void saveItem()}
              disabled={saving || notesDraft === (selected.myNotes ?? '')}
            >
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TopicImport: React.FC<{
  topicId: number;
  topicName: string;
  imports: { id: number; summary: string | null; created_at: string }[];
  onImported: (message: string) => Promise<void>;
  onError: (message: string) => void;
}> = ({ topicId, topicName, imports, onImported, onError }) => {
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildResearchTopicPrompt(topicName));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 5000);
    } catch {
      onError('Could not copy to clipboard.');
    }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const payload = extractJsonPayload(pasted);
      const data = await callApi<{ summary: string }>(`/api/research/topics/${topicId}/import`, {
        method: 'POST',
        body: JSON.stringify({ payload })
      });
      setPasted('');
      await onImported(data.summary || 'Research imported.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not import research');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="research-topics-import">
      <div className="research-topics-panel">
        <h3>1. Ask ChatGPT</h3>
        <p className="research-topics-muted">
          Copy the prompt, paste it into ChatGPT, and it will reply with JSON in the shape this page
          expects.
        </p>
        <button type="button" className="new-entry-button" onClick={() => void copyPrompt()}>
          {copied ? 'Copied — paste into ChatGPT' : `Copy ChatGPT prompt for “${topicName}”`}
        </button>
        <details className="research-topics-schema">
          <summary>Expected JSON shape</summary>
          <pre>{RESEARCH_TOPIC_JSON_SHAPE}</pre>
        </details>
      </div>

      <div className="research-topics-panel">
        <h3>2. Paste the answer back</h3>
        <p className="research-topics-muted">
          Paste the whole reply — code fences and surrounding text are fine. Brands and items are
          matched by name, so re-importing refines what&apos;s there instead of duplicating it. Your
          own notes and verdicts are never overwritten.
        </p>
        <textarea
          className="research-topics-textarea research-topics-textarea--code"
          rows={12}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder='{ "schemaVersion": 1, "topic": "Wetsuits", … }'
        />
        <button
          type="button"
          className="new-entry-button"
          onClick={() => void runImport()}
          disabled={busy || !pasted.trim()}
        >
          {busy ? 'Importing…' : 'Import research'}
        </button>
      </div>

      {imports.length > 0 ? (
        <div className="research-topics-panel">
          <h3>Recent imports</h3>
          <ul className="research-topics-import-log">
            {imports.map((row) => (
              <li key={row.id}>
                <span>{row.summary ?? 'Import'}</span>
                <span className="research-topics-muted">
                  {new Date(row.created_at).toLocaleString('en-GB')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default ResearchTopics;
