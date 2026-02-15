-- Add brand_id column to stock table
ALTER TABLE public.stock
ADD COLUMN IF NOT EXISTS brand_id INTEGER NULL;

-- Add foreign key constraint to reference brand table
ALTER TABLE public.stock
ADD CONSTRAINT fk_stock_brand_id
FOREIGN KEY (brand_id)
REFERENCES public.brand (id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stock_brand_id ON public.stock (brand_id);

-- Add comment to document the column
COMMENT ON COLUMN public.stock.brand_id IS 'Reference to the brand table';
