-- eBay sold comps cache (per brand). Run in Supabase SQL editor or psql.
-- Requires public.brand and public.brand_tag_image (see database/brand_tag_image.sql).

CREATE TABLE IF NOT EXISTS public.ebay_sold_listing_cache (
  id BIGSERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES public.brand (id) ON DELETE CASCADE,
  brand_tag_image_id INTEGER NULL REFERENCES public.brand_tag_image (id) ON DELETE SET NULL,
  ebay_item_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  image_url TEXT NULL,
  item_web_url TEXT NULL,
  price_value TEXT NULL,
  price_currency VARCHAR(16) NOT NULL DEFAULT 'GBP',
  condition_label VARCHAR(128) NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ebay_sold_listing_cache_brand_fetched_idx
  ON public.ebay_sold_listing_cache (brand_id, fetched_at DESC);

COMMENT ON TABLE public.ebay_sold_listing_cache IS
  'Cached eBay Browse sold comps per brand; rows share fetched_at from same sync. Valid for 24h in app logic.';
