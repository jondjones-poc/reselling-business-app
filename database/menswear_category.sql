-- Menswear category taxonomy for brand mapping (Research → Menswear categories).
-- Run after public.brand exists. Then run brand_add_menswear_category_id.sql and menswear_category_seed.sql.

CREATE TABLE IF NOT EXISTS public.menswear_category (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menswear_category_name_key UNIQUE (name)
);

COMMENT ON TABLE public.menswear_category IS
  'Optional menswear segment labels; brands link via brand.menswear_category_id.';

COMMENT ON COLUMN public.menswear_category.notes IS
  'Internal notes (buying strategy, caveats).';

CREATE INDEX IF NOT EXISTS idx_menswear_category_name_lower
  ON public.menswear_category (LOWER(name));
