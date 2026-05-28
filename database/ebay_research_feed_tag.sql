-- Saved search terms for Research → eBay tag feed (/research).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/ebay_research_feed_tag.sql

CREATE TABLE IF NOT EXISTS public.ebay_research_feed_tag (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL CHECK (char_length(trim(term)) > 0 AND char_length(trim(term)) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ebay_research_feed_tag_term_lower
  ON public.ebay_research_feed_tag (lower(trim(term)));

COMMENT ON TABLE public.ebay_research_feed_tag IS
  'User-defined eBay Browse search phrases for the Research tag feed.';

COMMENT ON COLUMN public.ebay_research_feed_tag.term IS
  'Search phrase (max 120 chars); matched case-insensitively when adding duplicates.';
