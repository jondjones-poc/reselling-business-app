-- Create brand table
CREATE TABLE IF NOT EXISTS public.brand (
  id SERIAL NOT NULL,
  brand_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT brand_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

-- Add unique constraint on brand_name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_name_unique ON public.brand (LOWER(TRIM(brand_name)));

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_brand_name ON public.brand (brand_name);

-- Function to update the 'updated_at' column automatically
CREATE OR REPLACE FUNCTION update_brand_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function on UPDATE
CREATE OR REPLACE TRIGGER update_brand_updated_at
BEFORE UPDATE ON public.brand
FOR EACH ROW
EXECUTE FUNCTION update_brand_updated_at_column();
