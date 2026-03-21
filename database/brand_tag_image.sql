-- Reference images for authentic brand tags / labels (Research page).
-- Run in Supabase SQL Editor (or psql) after public.brand exists.
--
-- Storage: create bucket + policies via database/supabase_storage_brand_tag_images.sql
-- (or Dashboard → Storage → New bucket → name: brand-tag-images, public read recommended).

-- Updated-at trigger (name avoids clashing with other project triggers).
CREATE OR REPLACE FUNCTION public.touch_brand_tag_image_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.brand_tag_image (
  id serial NOT NULL,
  brand_id integer NOT NULL,
  storage_path text NOT NULL,
  caption text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  content_type text NULL,
  image_kind text NOT NULL DEFAULT 'tag',
  created_at timestamptz NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NULL DEFAULT timezone('utc', now()),
  CONSTRAINT brand_tag_image_pkey PRIMARY KEY (id),
  CONSTRAINT brand_tag_image_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES public.brand (id) ON DELETE CASCADE,
  CONSTRAINT brand_tag_image_storage_path_key UNIQUE (storage_path),
  CONSTRAINT brand_tag_image_image_kind_check CHECK (image_kind IN ('tag', 'fake_check'))
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_brand_tag_image_brand_id
  ON public.brand_tag_image USING btree (brand_id);

CREATE INDEX IF NOT EXISTS idx_brand_tag_image_sort
  ON public.brand_tag_image USING btree (brand_id, sort_order, id);

DROP TRIGGER IF EXISTS update_brand_tag_image_updated_at ON public.brand_tag_image;
CREATE TRIGGER update_brand_tag_image_updated_at
  BEFORE UPDATE ON public.brand_tag_image
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_brand_tag_image_updated_at();

COMMENT ON TABLE public.brand_tag_image IS
  'Reference photos per brand (authentic tags vs fake-check warnings); files in Supabase Storage (storage_path).';
COMMENT ON COLUMN public.brand_tag_image.image_kind IS
  'tag = authentic tag/label; fake_check = counterfeit / fake warning signal reference.';

-- If your Postgres build rejects EXECUTE FUNCTION on triggers, use:
--   EXECUTE PROCEDURE public.touch_brand_tag_image_updated_at();
