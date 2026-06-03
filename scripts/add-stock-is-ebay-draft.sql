-- eBay draft flag: listing exists on eBay but is still a draft (not live).
-- Run against your app database (e.g. psql or Supabase SQL editor).

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS is_ebay_draft BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN stock.is_ebay_draft IS
  'When true, the item has an eBay listing that is still in draft state.';
