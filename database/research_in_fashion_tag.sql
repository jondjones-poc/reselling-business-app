-- Saved search terms for Research → In fashion (/research?view=in-fashion).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/research_in_fashion_tag.sql

CREATE TABLE IF NOT EXISTS public.research_in_fashion_tag (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL CHECK (char_length(trim(term)) > 0 AND char_length(trim(term)) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_in_fashion_tag_term_lower
  ON public.research_in_fashion_tag (lower(trim(term)));

COMMENT ON TABLE public.research_in_fashion_tag IS
  'User-defined trend/inspiration search phrases for Research → In fashion.';

COMMENT ON COLUMN public.research_in_fashion_tag.term IS
  'Search phrase (max 120 chars); matched case-insensitively when adding duplicates.';
