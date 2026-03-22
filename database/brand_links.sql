-- Useful reference URLs per brand (Research → Brand research).
-- Run after public.brand exists.

CREATE TABLE IF NOT EXISTS public.brand_links (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES public.brand (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  link_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_links_brand_id ON public.brand_links (brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_links_created_at ON public.brand_links (brand_id, created_at DESC);

COMMENT ON TABLE public.brand_links IS 'User-saved reference links for a brand (Research).';
