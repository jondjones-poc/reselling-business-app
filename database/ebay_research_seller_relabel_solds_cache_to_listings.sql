-- One-off: move ALL seller-solds cache rows to listing_mode = 'listings'.
--
-- Run once after ebay_research_seller_listing_mode.sql if legacy cache was tagged as solds
-- but is actually active listings.
--
-- After this:
--   • Listings toggle → all cached items
--   • Solds toggle → empty (↻ refresh per seller to rebuild solds)
--
--   psql "$DATABASE_URL" -f database/ebay_research_seller_relabel_solds_cache_to_listings.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ebay_research_seller_item_cache'
      AND column_name = 'listing_mode'
  ) THEN
    RAISE EXCEPTION 'listing_mode column missing — run database/ebay_research_seller_listing_mode.sql first';
  END IF;
END $$;

SELECT 'item_cache before' AS step, listing_mode, COUNT(*) AS n
FROM public.ebay_research_seller_item_cache
GROUP BY listing_mode
ORDER BY listing_mode;

SELECT 'feed_fetched before' AS step, listing_mode, COUNT(*) AS n
FROM public.ebay_research_seller_feed_fetched
GROUP BY listing_mode
ORDER BY listing_mode;

-- If any listings rows already exist, drop the solds duplicate first (same PK except mode)
DELETE FROM public.ebay_research_seller_item_cache AS stale
WHERE stale.listing_mode <> 'listings'
  AND EXISTS (
    SELECT 1
    FROM public.ebay_research_seller_item_cache AS keep
    WHERE keep.seller_id = stale.seller_id
      AND keep.ebay_item_id = stale.ebay_item_id
      AND keep.sold_days = stale.sold_days
      AND keep.min_price_gbp = stale.min_price_gbp
      AND keep.listing_mode = 'listings'
  );

UPDATE public.ebay_research_seller_item_cache
SET listing_mode = 'listings'
WHERE listing_mode <> 'listings';

DELETE FROM public.ebay_research_seller_feed_fetched AS stale
WHERE stale.listing_mode <> 'listings'
  AND EXISTS (
    SELECT 1
    FROM public.ebay_research_seller_feed_fetched AS keep
    WHERE keep.seller_id = stale.seller_id
      AND keep.sold_days = stale.sold_days
      AND keep.min_price_gbp = stale.min_price_gbp
      AND keep.listing_mode = 'listings'
  );

UPDATE public.ebay_research_seller_feed_fetched
SET listing_mode = 'listings'
WHERE listing_mode <> 'listings';

SELECT 'item_cache after' AS step, listing_mode, COUNT(*) AS n
FROM public.ebay_research_seller_item_cache
GROUP BY listing_mode
ORDER BY listing_mode;

SELECT 'feed_fetched after' AS step, listing_mode, COUNT(*) AS n
FROM public.ebay_research_seller_feed_fetched
GROUP BY listing_mode
ORDER BY listing_mode;

COMMIT;
