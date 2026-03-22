-- Add condition display column for existing installs (safe to re-run).
ALTER TABLE public.ebay_sold_listing_cache
  ADD COLUMN IF NOT EXISTS condition_label VARCHAR(128) NULL;
