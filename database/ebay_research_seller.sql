-- Tracked eBay seller usernames for Research → Seller Solds (/research?view=seller-solds).
-- Run in Supabase SQL editor or: psql "$DATABASE_URL" -f database/ebay_research_seller.sql

CREATE TABLE IF NOT EXISTS public.ebay_research_seller (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL CHECK (
    char_length(trim(username)) > 0
    AND char_length(trim(username)) <= 64
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ebay_research_seller_username_lower
  ON public.ebay_research_seller (lower(trim(username)));

COMMENT ON TABLE public.ebay_research_seller IS
  'eBay seller usernames to track in the Seller Solds competitor feed (Browse API sold listings).';

COMMENT ON COLUMN public.ebay_research_seller.username IS
  'eBay seller username (case-insensitive unique); matched when adding duplicates.';
