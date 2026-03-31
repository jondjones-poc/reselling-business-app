-- Optional link from stock line to a tag/care-label image in brand_tag_image.
-- Run after public.brand_tag_image exists. Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.stock
  ADD COLUMN IF NOT EXISTS brand_tag_image_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_brand_tag_image_id_fkey'
  ) THEN
    ALTER TABLE public.stock
      ADD CONSTRAINT stock_brand_tag_image_id_fkey
      FOREIGN KEY (brand_tag_image_id)
      REFERENCES public.brand_tag_image (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_brand_tag_image_id
  ON public.stock (brand_tag_image_id)
  WHERE brand_tag_image_id IS NOT NULL;

COMMENT ON COLUMN public.stock.brand_tag_image_id IS
  'Optional tag/care label image; must reference brand_tag_image for the same brand as stock.brand_id.';
