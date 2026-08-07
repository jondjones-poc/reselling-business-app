-- Weekly Google Trends interest cache per stock brand (rising / flat / fading).
-- Run in Supabase / psql:
--   psql "$DATABASE_URL" -f database/research_brand_trends_cache.sql
--
-- Cron: Cloudflare worker (research-seller-cache) →
--   POST /api/research/in-fashion/brand-trends/refresh (Bearer DB_KEEPALIVE_SECRET)

CREATE TABLE IF NOT EXISTS public.research_brand_trends_cache (
  brand_id INTEGER PRIMARY KEY REFERENCES public.brand(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  department_id INTEGER REFERENCES public.department(id) ON DELETE SET NULL,
  geo TEXT NOT NULL DEFAULT 'GB',
  -- [{ "time": unixSeconds, "label": "...", "value": 0-100 }, ...]
  interest_series JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_6m NUMERIC,
  score_1y NUMERIC,
  score_2y NUMERIC,
  score_5y NUMERIC,
  direction_6m TEXT,
  direction_1y TEXT,
  direction_2y TEXT,
  direction_5y TEXT,
  trends_error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_brand_trends_department
  ON public.research_brand_trends_cache (department_id);

CREATE INDEX IF NOT EXISTS idx_research_brand_trends_fetched_at
  ON public.research_brand_trends_cache (fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_brand_trends_direction_1y
  ON public.research_brand_trends_cache (direction_1y);

COMMENT ON TABLE public.research_brand_trends_cache IS
  'Cached Google Trends interest-over-time per brand; scores derived for 6m/1y/2y/5y windows.';
