-- YouTube channels for Research → Reseller Videos (/research?view=reseller-videos).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/reseller_youtube_channel.sql

CREATE TABLE IF NOT EXISTS public.reseller_youtube_channel (
  id SERIAL PRIMARY KEY,
  youtube_channel_id VARCHAR(64) NOT NULL
    CHECK (char_length(trim(youtube_channel_id)) > 0),
  channel_title TEXT,
  channel_handle TEXT,
  channel_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reseller_youtube_channel_youtube_id
  ON public.reseller_youtube_channel (youtube_channel_id);

COMMENT ON TABLE public.reseller_youtube_channel IS
  'Saved YouTube channels for the Research Reseller Videos feed.';

COMMENT ON COLUMN public.reseller_youtube_channel.youtube_channel_id IS
  'YouTube channel ID (UC…). Public Atom feed: /feeds/videos.xml?channel_id=… (no API key).';
