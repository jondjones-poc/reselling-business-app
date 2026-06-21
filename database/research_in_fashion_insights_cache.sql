-- Cached Google Trends + Pexels results per In fashion tag.
-- Run after research_in_fashion_tag.sql:
--   psql "$DATABASE_URL" -f database/research_in_fashion_insights_cache.sql

CREATE TABLE IF NOT EXISTS public.research_in_fashion_insights_cache (
  tag_id INTEGER PRIMARY KEY REFERENCES public.research_in_fashion_tag(id) ON DELETE CASCADE,
  related_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  rising_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  trends_error TEXT,
  pexels_error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_in_fashion_insights_fetched_at
  ON public.research_in_fashion_insights_cache (fetched_at DESC);

COMMENT ON TABLE public.research_in_fashion_insights_cache IS
  'Server-side cache for Google Trends related/rising queries and Pexels photos per tag.';
