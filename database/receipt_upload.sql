-- Receipt Scanner cloud uploads (Supabase Storage metadata).
-- Table is also auto-created on API startup via ensureDatabaseSchema().
--
-- Storage bucket (required): create once in Supabase Dashboard → Storage
--   Name: receipt-uploads  (or SUPABASE_STORAGE_RECEIPTS_BUCKET)
--   Public: OFF
-- The API also tries to auto-create this bucket on upload/list/download.
-- Downloads go through GET /api/receipt-uploads/:id/download (not a public URL).

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
