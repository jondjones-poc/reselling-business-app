-- Add category_id column to stock table
ALTER TABLE public.stock
ADD COLUMN IF NOT EXISTS category_id INTEGER NULL;

-- Add foreign key constraint to reference category table
ALTER TABLE public.stock
ADD CONSTRAINT fk_stock_category_id
FOREIGN KEY (category_id)
REFERENCES public.category (id)
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stock_category_id ON public.stock (category_id);

-- Add comment to document the column
COMMENT ON COLUMN public.stock.category_id IS 'Reference to the category table';
