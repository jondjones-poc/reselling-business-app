-- Script to update stock.category_id based on stock.category text values
-- This script matches category names from stock.category to category.category_name
-- and updates stock.category_id with the corresponding category.id

UPDATE public.stock
SET category_id = c.id
FROM public.category c
WHERE stock.category IS NOT NULL
    AND TRIM(stock.category) != ''
    AND LOWER(TRIM(stock.category)) = LOWER(TRIM(c.category_name))
    AND stock.category_id IS NULL;  -- Only update rows that don't already have a category_id

-- Verify the update
-- SELECT 
--     s.id,
--     s.category AS old_category_text,
--     s.category_id,
--     c.category_name AS new_category_name
-- FROM public.stock s
-- LEFT JOIN public.category c ON s.category_id = c.id
-- WHERE s.category IS NOT NULL
-- ORDER BY s.id;

-- Count how many rows were updated
-- SELECT 
--     COUNT(*) AS total_rows_with_category,
--     COUNT(category_id) AS rows_with_category_id,
--     COUNT(*) - COUNT(category_id) AS rows_missing_category_id
-- FROM public.stock
-- WHERE category IS NOT NULL AND TRIM(category) != '';
