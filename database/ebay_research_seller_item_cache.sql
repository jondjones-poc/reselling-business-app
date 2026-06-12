-- Cached sold listings for Research → Seller Solds (12h TTL per seller + filter set).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/ebay_research_seller_item_cache.sql

CREATE TABLE IF NOT EXISTS public.ebay_research_seller_item_cache (
  seller_id INTEGER NOT NULL
    REFERENCES public.ebay_research_seller (id) ON DELETE CASCADE,
  ebay_item_id TEXT NOT NULL CHECK (char_length(trim(ebay_item_id)) > 0),
  sold_days INTEGER NOT NULL CHECK (sold_days >= 7 AND sold_days <= 365),
  min_price_gbp INTEGER NOT NULL CHECK (min_price_gbp >= 0),
  seller_username TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  price_label TEXT NOT NULL DEFAULT '—',
  item_web_url TEXT,
  sold_at_ms BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (seller_id, ebay_item_id, sold_days, min_price_gbp)
);

CREATE INDEX IF NOT EXISTS idx_ebay_research_seller_item_cache_lookup
  ON public.ebay_research_seller_item_cache (sold_days, min_price_gbp, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_ebay_research_seller_item_cache_seller_fresh
  ON public.ebay_research_seller_item_cache (seller_id, sold_days, min_price_gbp, fetched_at DESC);

COMMENT ON TABLE public.ebay_research_seller_item_cache IS
  'Cached eBay sold listing cards for tracked sellers (keyed by seller + item id + filter set).';

COMMENT ON COLUMN public.ebay_research_seller_item_cache.ebay_item_id IS
  'Normalized eBay listing id (numeric legacy id when available).';

-- Last successful feed fetch per seller + filter set (avoids eBay API for 12 hours).
CREATE TABLE IF NOT EXISTS public.ebay_research_seller_feed_fetched (
  seller_id INTEGER NOT NULL
    REFERENCES public.ebay_research_seller (id) ON DELETE CASCADE,
  sold_days INTEGER NOT NULL CHECK (sold_days >= 7 AND sold_days <= 365),
  min_price_gbp INTEGER NOT NULL CHECK (min_price_gbp >= 0),
  item_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (seller_id, sold_days, min_price_gbp)
);

CREATE INDEX IF NOT EXISTS idx_ebay_research_seller_feed_fetched_at
  ON public.ebay_research_seller_feed_fetched (fetched_at DESC);

COMMENT ON TABLE public.ebay_research_seller_feed_fetched IS
  'Tracks when seller sold feed was last fetched from eBay for a soldDays/minPrice filter (12h cache window).';
