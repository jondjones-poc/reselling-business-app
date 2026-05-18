-- Bootsale / scouting todo: things to buy or look out for while sourcing.
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/scouting_source_item.sql

CREATE TABLE IF NOT EXISTS public.scouting_source_item (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
  notes TEXT,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scouting_source_item_open
  ON public.scouting_source_item (is_completed, sort_order ASC, created_at DESC);

COMMENT ON TABLE public.scouting_source_item IS
  'Scouting bootsale todo: items to buy or watch for while sourcing.';

COMMENT ON COLUMN public.scouting_source_item.title IS 'Short label for what to find (brand, category, size, etc.).';
COMMENT ON COLUMN public.scouting_source_item.notes IS 'Optional detail: max price, condition, colour, etc.';
COMMENT ON COLUMN public.scouting_source_item.is_completed IS 'True when found/bought or no longer needed.';
COMMENT ON COLUMN public.scouting_source_item.sort_order IS 'Manual ordering within open items (lower = higher).';
