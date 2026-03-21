-- Migration: classify each brand_tag_image as an authentic tag example or a fake-check warning.
-- Run once in Supabase SQL Editor (or psql) on existing databases that already have brand_tag_image.
--
-- Values: 'tag' (default) = authentic tag/label reference; 'fake_check' = fake warning signal.

ALTER TABLE public.brand_tag_image
  ADD COLUMN IF NOT EXISTS image_kind text NOT NULL DEFAULT 'tag';

ALTER TABLE public.brand_tag_image
  DROP CONSTRAINT IF EXISTS brand_tag_image_image_kind_check;

ALTER TABLE public.brand_tag_image
  ADD CONSTRAINT brand_tag_image_image_kind_check
  CHECK (image_kind IN ('tag', 'fake_check'));

COMMENT ON COLUMN public.brand_tag_image.image_kind IS
  'tag = authentic tag/label; fake_check = counterfeit / fake warning signal reference.';
