-- Script to remove the 'vinted' boolean column from the stock table
-- This column has been replaced by vinted_id: if vinted_id has a value, the item is listed on Vinted

-- Drop the vinted column
ALTER TABLE public.stock
DROP COLUMN IF EXISTS vinted;

-- Verify the column has been removed
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_schema = 'public' 
--   AND table_name = 'stock' 
--   AND column_name = 'vinted';
-- Expected result: No rows returned
