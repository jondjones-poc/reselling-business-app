-- Add new columns to expenses table
-- receipt_name: for storing the receipt file name
-- purchase_location: for storing where the item was purchased

ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS receipt_name CHARACTER VARYING,
ADD COLUMN IF NOT EXISTS purchase_location CHARACTER VARYING;

-- Add comments to document the columns
COMMENT ON COLUMN public.expenses.receipt_name IS 'Name of the receipt file';
COMMENT ON COLUMN public.expenses.purchase_location IS 'Location/place where the item was purchased';
