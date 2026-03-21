-- Supabase Storage: bucket + policies for brand tag example images.
-- Run in Supabase SQL Editor after Storage is enabled on the project.
--
-- Env (backend / server only — never expose service role to the browser):
--   SUPABASE_URL=https://<project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
--   SUPABASE_STORAGE_BRAND_TAGS_BUCKET=brand-tag-images   (optional; must match id below)
--
-- Public URLs (when bucket is public):
--   https://<project-ref>.supabase.co/storage/v1/object/public/brand-tag-images/<storage_path>

-- Minimal insert (works across Supabase versions). Tighten limits in Dashboard → Storage if you like.
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-tag-images', 'brand-tag-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Allow anyone to read objects (app is already behind your auth if needed).
DROP POLICY IF EXISTS "Public read brand tag images" ON storage.objects;
CREATE POLICY "Public read brand tag images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-tag-images');

-- Uploads go through your Node API with the service role (bypasses RLS).
-- Optional: allow authenticated users to upload from the client (uncomment if you add anon upload later).
-- DROP POLICY IF EXISTS "Authenticated upload brand tag images" ON storage.objects;
-- CREATE POLICY "Authenticated upload brand tag images"
--   ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'brand-tag-images');
