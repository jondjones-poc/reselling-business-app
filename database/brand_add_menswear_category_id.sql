-- Optional FK from brand to menswear_category.
-- Requires public.menswear_category (see menswear_category.sql).

ALTER TABLE public.brand
  ADD COLUMN IF NOT EXISTS menswear_category_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_menswear_category_id_fkey'
  ) THEN
    ALTER TABLE public.brand
      ADD CONSTRAINT brand_menswear_category_id_fkey
      FOREIGN KEY (menswear_category_id)
      REFERENCES public.menswear_category (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_brand_menswear_category_id
  ON public.brand (menswear_category_id);

COMMENT ON COLUMN public.brand.menswear_category_id IS
  'Optional menswear segment; NULL = uncategorised.';
