-- Create orders table for storing items to pick up
-- This replaces the cookie-based storage to enable cross-device access

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_id)
);

-- Create index on stock_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_stock_id ON orders(stock_id);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Add foreign key constraint to ensure stock_id references valid stock items
-- Note: This assumes the stock table exists. If you need to add this later, use:
-- ALTER TABLE orders ADD CONSTRAINT fk_orders_stock_id FOREIGN KEY (stock_id) REFERENCES stock(id) ON DELETE CASCADE;

-- Optional: Add a trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();
