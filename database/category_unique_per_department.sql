-- Stock category names unique per department (same name allowed in different departments).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/category_unique_per_department.sql

ALTER TABLE public.category
  ADD COLUMN IF NOT EXISTS department_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'category_department_id_fkey'
  ) THEN
    ALTER TABLE public.category
      ADD CONSTRAINT category_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES public.department (id) ON DELETE RESTRICT;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop legacy global unique on category_name if present.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'category'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = c.conkey[1]
          AND a.attname = 'category_name'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.category DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.idx_category_name_lower;
DROP INDEX IF EXISTS public.idx_category_department_name_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_department_name_lower
  ON public.category (department_id, (LOWER(TRIM(BOTH FROM category_name))))
  WHERE department_id IS NOT NULL;
