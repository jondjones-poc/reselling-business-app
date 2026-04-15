-- Inventory write-off: item is unsellable (damaged, defective, etc.) — business write-off flag.
-- Run against your app database (e.g. psql or Supabase SQL editor).

ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS is_inventory_write_off BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN stock.is_inventory_write_off IS
  'When true, stock is treated as a business write-off (unsellable).';
