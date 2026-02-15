-- Script to remove the 'category' and 'ebay' columns from the stock table
-- These columns have been replaced by:
--   - category_id: Foreign key to the category table
--   - ebay_id: If this has a value, the item is listed on eBay

-- Drop the category column
ALTER TABLE public.stock
DROP COLUMN IF EXISTS category;

-- Drop the ebay column
ALTER TABLE public.stock
DROP COLUMN IF EXISTS ebay;

-- Verify the columns have been removed
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' 
--   AND table_name = 'stock' 
--   AND column_name IN ('category', 'ebay');
-- Expected result: No rows returned
