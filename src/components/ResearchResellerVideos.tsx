import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './Stock.css';
import './ResearchResellerVideos.css';

type ResellerChannel = {
  id: number;
  youtube_channel_id: string;
  channel_title: string | null;
  channel_handle: string | null;
  channel_url: string | null;
  thumbnail_url: string | null;
  created_at?: string;
};

type ResellerVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  watchUrl: string;
  savedChannelId: number;
  savedChannelTitle: string;
  savedChannelUrl: string | null;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function formatPublishedDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ResearchResellerVideos: React.FC = () => {
  const [channels, setChannels] = useState<ResellerChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [videos, setVideos] = useState<ResellerVideo[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedWarnings, setFeedWarnings] = useState<string[]>([]);

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch(apiUrl('/api/research/reseller-videos/channels'));
      const data = await readJson<{ rows?: ResellerChannel[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      setChannels(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setChannelsError(e instanceof Error ? e.message : 'Could not load channels');
      setChannels([]);
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  const loadFeed = useCallback(
    async (channelRows: ResellerChannel[], refresh = false) => {
      if (channelRows.length === 0) {
        setVideos([]);
        setFeedWarnings([]);
        setFeedError(null);
        return;
      }
      setFeedLoading(true);
      setFeedError(null);
      setFeedWarnings([]);
      try {
        const q = refresh ? '?refresh=1' : '';
        const res = await fetch(apiUrl(`/api/research/reseller-videos/feed${q}`));
        const data = await readJson<{
          videos?: ResellerVideo[];
          errors?: { channelTitle: string; error: string }[];
          error?: string;
          details?: string;
        }>(res);
        if (!res.ok) throw new Error(data.details || data.error || res.statusText);
        setVideos(Array.isArray(data.videos) ? data.videos : []);
        setFeedWarnings(
          (data.errors ?? []).map((row) => `${row.channelTitle}: ${row.error}`)
        );
      } catch (e) {
        setFeedError(e instanceof Error ? e.message : 'Could not load videos');
        setVideos([]);
      } finally {
        setFeedLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (channelsLoading) return;
    void loadFeed(channels);
  }, [channels, channelsLoading, loadFeed]);

  const handleAddChannel = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = newChannel.trim();
    if (!value || addBusy) return;
    setAddBusy(true);
    setChannelsError(null);
    try {
      const res = await fetch(apiUrl('/api/research/reseller-videos/channels'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: value })
      });
      const data = await readJson<{ row?: ResellerChannel; error?: string; details?: string }>(res);
      if (!res.ok) throw new Error(data.details || data.error || res.statusText);
      if (data.row) {
        setChannels((prev) => {
          if (prev.some((c) => c.id === data.row!.id)) return prev;
          return [...prev, data.row!];
        });
      }
      setNewChannel('');
    } catch (e) {
      setChannelsError(e instanceof Error ? e.message : 'Could not add channel');
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemoveChannel = async (id: number) => {
    setChannelsError(null);
    try {
      const res = await fetch(apiUrl(`/api/research/reseller-videos/channels/${id}`), {
        method: 'DELETE'
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      setChannels((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setChannelsError(e instanceof Error ? e.message : 'Could not remove channel');
    }
  };

  return (
    <div className="research-reseller-videos">
      <form className="research-reseller-videos-toolbar" onSubmit={handleAddChannel}>
        <input
          type="text"
          className="search-input research-reseller-videos-toolbar-search"
          placeholder="YouTube channel URL or @handle…"
          value={newChannel}
          onChange={(e) => setNewChannel(e.target.value)}
          disabled={addBusy}
          aria-label="YouTube channel URL or handle"
        />
        <button type="submit" className="new-entry-button" disabled={addBusy || !newChannel.trim()}>
          {addBusy ? 'Adding…' : 'Add channel'}
        </button>
        <button
          type="button"
          className="stock-refresh-icon-button"
          title="Refresh video feed"
          aria-label="Refresh video feed"
          disabled={feedLoading || channels.length === 0}
          onClick={() => void loadFeed(channels, true)}
        >
          ↻
        </button>
      </form>

      {channelsError && (
        <div className="research-reseller-videos-banner research-reseller-videos-banner--error" role="alert">
          {channelsError}
        </div>
      )}

      <div className="research-reseller-videos-channels" aria-label="Saved YouTube channels">
        {channelsLoading && <span className="research-reseller-videos-muted">Loading channels…</span>}
        {!channelsLoading && channels.length === 0 && (
          <span className="research-reseller-videos-muted">
            Add a channel to build your reseller video feed.
          </span>
        )}
        {channels.map((ch, i) => (
          <span
            key={ch.id}
            className={`research-reseller-videos-chip research-reseller-videos-chip--tone-${i % 6}`}
          >
            {ch.thumbnail_url ? (
              <img
                src={ch.thumbnail_url}
                alt=""
                className="research-reseller-videos-chip-avatar"
                width={22}
                height={22}
              />
            ) : null}
            <a
              href={ch.channel_url || `https://www.youtube.com/channel/${ch.youtube_channel_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="research-reseller-videos-chip-label"
              title={ch.channel_title || ch.youtube_channel_id}
            >
              {ch.channel_title || ch.channel_handle || ch.youtube_channel_id}
            </a>
            <button
              type="button"
              className="research-reseller-videos-chip-remove"
              aria-label={`Remove ${ch.channel_title || ch.youtube_channel_id}`}
              onClick={() => void handleRemoveChannel(ch.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {feedError && (
        <div className="research-reseller-videos-banner research-reseller-videos-banner--error" role="alert">
          {feedError}
        </div>
      )}

      {feedWarnings.length > 0 && (
        <div className="research-reseller-videos-banner research-reseller-videos-banner--warn" role="status">
          {feedWarnings.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      {feedLoading && videos.length === 0 && channels.length > 0 && (
        <div className="research-reseller-videos-grid" aria-busy="true" aria-label="Loading videos">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="research-reseller-videos-skeleton" />
          ))}
        </div>
      )}

      {!feedLoading && channels.length > 0 && videos.length === 0 && !feedError && (
        <p className="research-reseller-videos-muted">No videos returned for your saved channels.</p>
      )}

      {videos.length > 0 && (
        <div className="research-reseller-videos-grid" aria-label="Reseller videos newest first">
          {videos.map((video) => (
            <article key={video.videoId} className="research-reseller-videos-card">
              <a
                href={video.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="research-reseller-videos-card-link"
                title={`Watch on YouTube: ${video.title}`}
              >
                <div className="research-reseller-videos-card-media">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="research-reseller-videos-card-media-fallback">No thumbnail</div>
                  )}
                </div>
                <div className="research-reseller-videos-card-body">
                  <h3 className="research-reseller-videos-card-title">{video.title}</h3>
                  <div className="research-reseller-videos-card-meta">
                    <span className="research-reseller-videos-card-channel">
                      {video.savedChannelTitle}
                    </span>
                    {video.publishedAt ? (
                      <time dateTime={video.publishedAt} className="research-reseller-videos-card-date">
                        {formatPublishedDate(video.publishedAt)}
                      </time>
                    ) : null}
                  </div>
                </div>
              </a>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResearchResellerVideos;
