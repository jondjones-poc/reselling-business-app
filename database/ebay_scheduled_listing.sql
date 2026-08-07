-- Scheduled eBay draft publishes (Seller Hub unpublished Inventory offers).
-- Cron: Cloudflare research-seller-cache daily job → POST /api/ebay/scheduled-listings/run
-- Apply: psql "$DATABASE_URL" -f database/ebay_scheduled_listing.sql  (or Supabase SQL editor)

CREATE TABLE IF NOT EXISTS public.ebay_scheduled_listing (
  id BIGSERIAL PRIMARY KEY,
  offer_id TEXT NOT NULL,
  sku TEXT,
  title TEXT,
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_GB',
  price_value NUMERIC,
  price_currency TEXT,
  scheduled_for DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'cancelled')),
  listing_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ebay_scheduled_listing_pending_offer_uidx
  ON public.ebay_scheduled_listing (offer_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ebay_scheduled_listing_due_idx
  ON public.ebay_scheduled_listing (scheduled_for, status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS ebay_scheduled_listing_status_idx
  ON public.ebay_scheduled_listing (status, scheduled_for);

COMMENT ON TABLE public.ebay_scheduled_listing IS
  'Queue of eBay Inventory unpublished offers to publish on a calendar date (UK).';
