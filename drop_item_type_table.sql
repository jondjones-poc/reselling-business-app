-- Script to delete the item_type table
-- This will only delete the item_type table and nothing else

-- Drop the table if it exists
DROP TABLE IF EXISTS public.item_type;

-- Verify the table has been deleted (uncomment to check)
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name = 'item_type';
