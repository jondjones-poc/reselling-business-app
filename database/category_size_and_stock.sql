-- Per-category size options (e.g. tops: S/M/L; jackets: 42R; trousers: 34W).
-- Run after `category` exists. Optional FK from stock to the chosen size row.

CREATE TABLE IF NOT EXISTS public.category_size (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES public.category (id) ON DELETE CASCADE,
  size_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT category_size_unique_per_category UNIQUE (category_id, size_label)
);

CREATE INDEX IF NOT EXISTS idx_category_size_category_id
  ON public.category_size (category_id);

ALTER TABLE public.stock
  ADD COLUMN IF NOT EXISTS category_size_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_category_size_id_fkey'
  ) THEN
    ALTER TABLE public.stock
      ADD CONSTRAINT stock_category_size_id_fkey
      FOREIGN KEY (category_size_id) REFERENCES public.category_size (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_category_size_id
  ON public.stock (category_size_id);

COMMENT ON TABLE public.category_size IS
  'Allowed size labels per stock category; stock.category_size_id optionally references one row.';

COMMENT ON COLUMN public.category_size.size_label IS
  'Display value only, e.g. Small, 42R, 34W.';

-- Example seed (adjust category_id to match your category rows):
-- INSERT INTO public.category_size (category_id, size_label, sort_order) VALUES
--   (1, 'Small', 1), (1, 'Medium', 2), (1, 'Large', 3),
--   (2, '38R', 1), (2, '40R', 2), (2, '42R', 3),
--   (3, '30W', 1), (3, '32W', 2), (3, '34W', 3);
