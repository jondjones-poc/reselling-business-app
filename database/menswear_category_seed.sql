-- Seed default menswear categories (idempotent). Run after menswear_category.sql.

INSERT INTO public.menswear_category (name, description)
VALUES
  (
    'Surf Wear',
    'Surf and beach lifestyle brands.'
  ),
  (
    'Countrywear',
    'Rural / country lifestyle clothing.'
  ),
  (
    'Highend',
    'Luxury and high-end menswear positioning.'
  ),
  (
    'British heritage & countrywear',
    'Heritage British labels and countrywear crossover.'
  ),
  (
    'Technical outdoor & hiking',
    'Performance outdoor, hiking, and technical layers.'
  ),
  (
    'Premium knitwear & fabric specialists',
    'Knit-led brands and fabric-forward specialists.'
  ),
  (
    'Denim & workwear',
    'Denim-focused and workwear aesthetics.'
  ),
  (
    'Contemporary menswear',
    'Modern mainstream menswear and designer diffusion.'
  ),
  (
    'Smart tailoring & premium menswear',
    'Tailoring, formal, and elevated smart casual.'
  )
ON CONFLICT (name) DO NOTHING;
