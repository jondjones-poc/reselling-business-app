-- Stock form: brand names unique per stock category (category table), not globally per department.
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/brand_add_stock_category.sql
-- Restart the API after running so ensureBrandStockCategorySchema can apply indexes.

ALTER TABLE public.brand
  ADD COLUMN IF NOT EXISTS category_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_category_id_fkey'
  ) THEN
    ALTER TABLE public.brand
      ADD CONSTRAINT brand_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.category (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brand_category_id ON public.brand (category_id);

-- Legacy brands (no stock category): still unique per department.
DROP INDEX IF EXISTS public.idx_brand_department_name_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_department_name_lower
  ON public.brand (department_id, (LOWER(TRIM(BOTH FROM brand_name))))
  WHERE category_id IS NULL;

-- Stock quick-add brands: unique per stock category.
DROP INDEX IF EXISTS public.idx_brand_stock_category_name_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_stock_category_name_lower
  ON public.brand (category_id, (LOWER(TRIM(BOTH FROM brand_name))))
  WHERE category_id IS NOT NULL;
