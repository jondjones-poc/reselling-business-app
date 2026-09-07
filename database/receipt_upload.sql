-- Receipt Scanner cloud uploads (Supabase Storage metadata).
-- Table is also auto-created on API startup via ensureDatabaseSchema().
--
-- Storage bucket (required): create once in Supabase Dashboard → Storage
--   Name: receipt-uploads  (or SUPABASE_STORAGE_RECEIPTS_BUCKET)
--   Public: OFF
-- The API also tries to auto-create this bucket on upload/list/download.
-- Downloads go through GET /api/receipt-uploads/:id/download (not a public URL).
--
-- If uploads fail with "new row violates row-level security policy", run the
-- storage policies below (or restart the API — it creates them on boot).

CREATE TABLE IF NOT EXISTS receipt_upload (
  id SERIAL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  content_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  doc_type VARCHAR(32),
  receipt_date DATE,
  byte_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_upload_created_at ON receipt_upload (created_at DESC);

ALTER TABLE IF EXISTS receipt_upload DISABLE ROW LEVEL SECURITY;

-- Storage RLS (storage.objects). Safe to re-run: skips existing policy names.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'receipt_uploads_insert'
  ) THEN
    CREATE POLICY receipt_uploads_insert ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'receipt-uploads');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'receipt_uploads_select'
  ) THEN
    CREATE POLICY receipt_uploads_select ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'receipt-uploads');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'receipt_uploads_update'
  ) THEN
    CREATE POLICY receipt_uploads_update ON storage.objects
      FOR UPDATE TO public
      USING (bucket_id = 'receipt-uploads')
      WITH CHECK (bucket_id = 'receipt-uploads');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'receipt_uploads_delete'
  ) THEN
    CREATE POLICY receipt_uploads_delete ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'receipt-uploads');
  END IF;
END $$;
