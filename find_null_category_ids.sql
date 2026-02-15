-- Script to find stock rows where category_id is NULL
-- This helps identify rows that may need manual review or have category names that don't match

-- Find all stock rows with NULL category_id
SELECT 
    id,
    item_name,
    category AS category_text,
    category_id,
    purchase_date
FROM public.stock
WHERE category_id IS NULL
ORDER BY id;

-- Count how many rows have NULL category_id
SELECT 
    COUNT(*) AS rows_with_null_category_id,
    COUNT(CASE WHEN category IS NOT NULL AND TRIM(category) != '' THEN 1 END) AS rows_with_category_text_but_no_id
FROM public.stock
WHERE category_id IS NULL;

-- Find rows that have category text but no category_id (potential mismatches)
SELECT 
    s.id,
    s.item_name,
    s.category AS category_text,
    s.category_id,
    CASE 
        WHEN s.category IS NOT NULL AND TRIM(s.category) != '' THEN 'Has category text but no ID'
        ELSE 'No category text'
    END AS issue_type
FROM public.stock s
WHERE s.category_id IS NULL
ORDER BY 
    CASE WHEN s.category IS NOT NULL AND TRIM(s.category) != '' THEN 0 ELSE 1 END,
    s.id;
