-- Add image_kind value 'logo' (one per brand; used for Stock listing image prompt reference).
-- Safe to re-run: drops and recreates the check constraint by name.
-- Run after public.brand_tag_image exists.

ALTER TABLE public.brand_tag_image
  DROP CONSTRAINT IF EXISTS brand_tag_image_image_kind_check;

ALTER TABLE public.brand_tag_image
  ADD CONSTRAINT brand_tag_image_image_kind_check
  CHECK (
    image_kind = ANY (ARRAY['tag'::text, 'fake_check'::text, 'logo'::text])
  );

-- At most one logo row per brand (enforced in app on upload; index makes races fail safely).
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_tag_image_one_logo_per_brand
  ON public.brand_tag_image (brand_id)
  WHERE image_kind = 'logo';

COMMENT ON CONSTRAINT brand_tag_image_image_kind_check ON public.brand_tag_image IS
  'tag = care label / reference; fake_check = authenticity refs; logo = single brand mark for listing-image prompts.';
