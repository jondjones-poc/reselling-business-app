-- Create category table
CREATE TABLE IF NOT EXISTS public.category (
  id SERIAL NOT NULL,
  category_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT category_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- Add unique constraint on category_name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_name_unique ON public.category (LOWER(TRIM(category_name)));

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_category_name ON public.category (category_name);

-- Function to update the 'updated_at' column automatically
CREATE OR REPLACE FUNCTION update_category_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on UPDATE
CREATE OR REPLACE TRIGGER update_category_updated_at
BEFORE UPDATE ON public.category
FOR EACH ROW
EXECUTE FUNCTION update_category_updated_at_column();
