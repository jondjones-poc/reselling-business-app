-- Adds quality tier for brand tag / fake-check reference images.
-- Run once in Supabase SQL editor or psql.
--
-- Stored values: good, average, poor (UI: Best, Average, Bad).

ALTER TABLE public.brand_tag_image
  ADD COLUMN IF NOT EXISTS quality_tier text;

UPDATE public.brand_tag_image
SET quality_tier = 'average'
WHERE quality_tier IS NULL;

ALTER TABLE public.brand_tag_image
  ALTER COLUMN quality_tier SET DEFAULT 'average',
  ALTER COLUMN quality_tier SET NOT NULL;

DO $q$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_tag_image_quality_tier_check'
  ) THEN
    ALTER TABLE public.brand_tag_image
      ADD CONSTRAINT brand_tag_image_quality_tier_check
      CHECK (
        quality_tier = ANY (ARRAY['good'::text, 'average'::text, 'poor'::text])
      );
  END IF;
END $q$;

COMMENT ON COLUMN public.brand_tag_image.quality_tier IS
  'Reference quality: good=best examples, average, poor=bad/warning examples.';
