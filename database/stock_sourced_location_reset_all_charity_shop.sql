-- Set every stock row's sourced_location to charity_shop.
-- Safe with constraint stock_sourced_location_check (charity_shop is allowed).
-- Run after sourced_location column exists (see stock_sourced_location.sql).

UPDATE public.stock
SET sourced_location = 'charity_shop'
WHERE sourced_location IS DISTINCT FROM 'charity_shop';

-- Optional: verify counts after run
-- SELECT sourced_location, COUNT(*) FROM public.stock GROUP BY sourced_location ORDER BY 1;
