-- Script to migrate unique categories from stock.category to category table
-- This script extracts all unique category names from stock.category column
-- and inserts them into the category table

-- First, let's see what unique categories exist
-- SELECT DISTINCT category FROM stock WHERE category IS NOT NULL AND category != '' ORDER BY category;

-- Insert unique categories from stock table into category table
-- This will skip any categories that already exist (case-insensitive)
INSERT INTO public.category (category_name)
SELECT DISTINCT 
    TRIM(category) AS category_name
FROM public.stock
WHERE category IS NOT NULL 
    AND TRIM(category) != ''
    AND TRIM(category) IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM public.category c 
        WHERE LOWER(TRIM(c.category_name)) = LOWER(TRIM(stock.category))
    );

-- Verify the insert
-- SELECT id, category_name FROM public.category ORDER BY category_name;
