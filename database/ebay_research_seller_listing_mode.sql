-- Separate cached feeds for active listings vs completed solds per seller.
-- Run after ebay_research_seller_item_cache.sql

ALTER TABLE public.ebay_research_seller_item_cache
  ADD COLUMN IF NOT EXISTS listing_mode TEXT NOT NULL DEFAULT 'solds'
  CHECK (listing_mode IN ('solds', 'listings'));

ALTER TABLE public.ebay_research_seller_feed_fetched
  ADD COLUMN IF NOT EXISTS listing_mode TEXT NOT NULL DEFAULT 'solds'
  CHECK (listing_mode IN ('solds', 'listings'));

ALTER TABLE public.ebay_research_seller_item_cache
  DROP CONSTRAINT IF EXISTS ebay_research_seller_item_cache_pkey;

ALTER TABLE public.ebay_research_seller_item_cache
  ADD PRIMARY KEY (seller_id, ebay_item_id, sold_days, min_price_gbp, listing_mode);

ALTER TABLE public.ebay_research_seller_feed_fetched
  DROP CONSTRAINT IF EXISTS ebay_research_seller_feed_fetched_pkey;

ALTER TABLE public.ebay_research_seller_feed_fetched
  ADD PRIMARY KEY (seller_id, sold_days, min_price_gbp, listing_mode);

CREATE INDEX IF NOT EXISTS idx_ebay_research_seller_item_cache_mode
  ON public.ebay_research_seller_item_cache (listing_mode, sold_days, min_price_gbp, fetched_at DESC);

COMMENT ON COLUMN public.ebay_research_seller_item_cache.listing_mode IS
  'solds = completed sales (soldDate filter); listings = active buyable listings.';
