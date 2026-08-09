-- Create a Shoes department and move Menswear / Womenswear "Shoes" stock into it.
--
-- Single DO-block so it works in the Supabase SQL editor (no temp tables across
-- auto-committed statements).
--
-- What this does:
--   1. Creates department "Shoes" (idempotent).
--   2. Creates categories under Shoes: Trainers, Wellies, Boots.
--   3. Copies size labels from source Shoes categories onto all three new categories.
--   4. Copies brands used by shoe stock (and brands linked to source Shoes categories)
--      into Shoes as department-level brands (category_id NULL). Shared Menswear brands
--      (Nike, etc.) are COPIED, not moved.
--   5. Remaps all stock on Menswear Shoes + Womenswear Shoes → Shoes / Trainers.
--
-- Does NOT delete the old Menswear/Womenswear "Shoes" categories (left empty).
-- Safe to re-run.

DO $$
DECLARE
  src_count int;
  shoes_dept_id int;
  trainers_id int;
  wellies_id int;
  boots_id int;
  remaining int;
  trainers_stock int;
  brand_count int;
  size_count int;
BEGIN
  SELECT COUNT(*)::int INTO src_count
  FROM public.category c
  JOIN public.department d ON d.id = c.department_id
  WHERE LOWER(TRIM(c.category_name)) = 'shoes'
    AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear');

  IF src_count = 0 THEN
    RAISE EXCEPTION
      'No Menswear/Womenswear category named "Shoes" found — aborting. Check category names first.';
  END IF;
  RAISE NOTICE 'Source shoe categories: %', src_count;

  -- 1) Shoes department
  INSERT INTO public.department (department_name)
  SELECT 'Shoes'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.department
    WHERE LOWER(TRIM(department_name)) = 'shoes'
  );

  SELECT d.id INTO shoes_dept_id
  FROM public.department d
  WHERE LOWER(TRIM(d.department_name)) = 'shoes'
  LIMIT 1;

  IF shoes_dept_id IS NULL THEN
    RAISE EXCEPTION 'Failed to resolve Shoes department id';
  END IF;

  -- 2) Categories: Trainers (stock target), Wellies, Boots
  INSERT INTO public.category (category_name, department_id)
  SELECT v.category_name, shoes_dept_id
  FROM (
    VALUES ('Trainers'), ('Wellies'), ('Boots')
  ) AS v(category_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.category c
    WHERE c.department_id = shoes_dept_id
      AND LOWER(TRIM(c.category_name)) = LOWER(v.category_name)
  );

  SELECT c.id INTO trainers_id
  FROM public.category c
  WHERE c.department_id = shoes_dept_id
    AND LOWER(TRIM(c.category_name)) = 'trainers'
  LIMIT 1;

  SELECT c.id INTO wellies_id
  FROM public.category c
  WHERE c.department_id = shoes_dept_id
    AND LOWER(TRIM(c.category_name)) = 'wellies'
  LIMIT 1;

  SELECT c.id INTO boots_id
  FROM public.category c
  WHERE c.department_id = shoes_dept_id
    AND LOWER(TRIM(c.category_name)) = 'boots'
  LIMIT 1;

  IF trainers_id IS NULL OR wellies_id IS NULL OR boots_id IS NULL THEN
    RAISE EXCEPTION 'Failed to resolve Shoes Trainers / Wellies / Boots category ids';
  END IF;

  RAISE NOTICE 'Shoes department_id=%, trainers=%, wellies=%, boots=%',
    shoes_dept_id, trainers_id, wellies_id, boots_id;

  -- 3) Copy sizes from source Shoes categories onto Trainers, Wellies, and Boots
  INSERT INTO public.category_size (category_id, size_label, sort_order)
  SELECT dst.category_id, src.size_label, src.sort_order
  FROM (
    SELECT DISTINCT ON (LOWER(TRIM(cs.size_label)))
      TRIM(cs.size_label) AS size_label,
      COALESCE(cs.sort_order, 0) AS sort_order
    FROM public.category_size cs
    WHERE cs.category_id IN (
      SELECT c.id
      FROM public.category c
      JOIN public.department d ON d.id = c.department_id
      WHERE LOWER(TRIM(c.category_name)) = 'shoes'
        AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
    )
      AND TRIM(COALESCE(cs.size_label, '')) <> ''
    ORDER BY LOWER(TRIM(cs.size_label)), cs.sort_order NULLS LAST, cs.id
  ) src
  CROSS JOIN (
    SELECT trainers_id AS category_id
    UNION ALL SELECT wellies_id
    UNION ALL SELECT boots_id
  ) dst
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.category_size existing
    WHERE existing.category_id = dst.category_id
      AND LOWER(TRIM(existing.size_label)) = LOWER(TRIM(src.size_label))
  );

  -- 4) Copy brands (department-level under Shoes) used by shoe stock or linked to source categories
  INSERT INTO public.brand (
    brand_name,
    department_id,
    category_id,
    brand_website,
    things_to_buy,
    things_to_avoid,
    description,
    menswear_category_id
  )
  SELECT
    src.brand_name,
    shoes_dept_id,
    NULL,
    src.brand_website,
    src.things_to_buy,
    src.things_to_avoid,
    src.description,
    NULL
  FROM (
    SELECT DISTINCT ON (LOWER(TRIM(b.brand_name)))
      TRIM(b.brand_name) AS brand_name,
      b.brand_website,
      b.things_to_buy,
      b.things_to_avoid,
      b.description
    FROM public.brand b
    WHERE TRIM(COALESCE(b.brand_name, '')) <> ''
      AND (
        b.category_id IN (
          SELECT c.id
          FROM public.category c
          JOIN public.department d ON d.id = c.department_id
          WHERE LOWER(TRIM(c.category_name)) = 'shoes'
            AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
        )
        OR b.id IN (
          SELECT DISTINCT s.brand_id
          FROM public.stock s
          WHERE s.category_id IN (
            SELECT c.id
            FROM public.category c
            JOIN public.department d ON d.id = c.department_id
            WHERE LOWER(TRIM(c.category_name)) = 'shoes'
              AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
          )
            AND s.brand_id IS NOT NULL
        )
      )
    ORDER BY
      LOWER(TRIM(b.brand_name)),
      CASE
        WHEN b.category_id IN (
          SELECT c.id
          FROM public.category c
          JOIN public.department d ON d.id = c.department_id
          WHERE LOWER(TRIM(c.category_name)) = 'shoes'
            AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
        ) THEN 0
        ELSE 1
      END,
      b.id
  ) src
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.brand existing
    WHERE existing.department_id = shoes_dept_id
      AND existing.category_id IS NULL
      AND LOWER(TRIM(existing.brand_name)) = LOWER(TRIM(src.brand_name))
  );

  -- 5) Remap stock → Shoes / Trainers
  UPDATE public.stock AS s
  SET
    category_id = trainers_id,
    brand_id = COALESCE(
      (
        SELECT nb.id
        FROM public.brand ob
        JOIN public.brand nb
          ON nb.department_id = shoes_dept_id
         AND nb.category_id IS NULL
         AND LOWER(TRIM(nb.brand_name)) = LOWER(TRIM(ob.brand_name))
        WHERE ob.id = s.brand_id
        LIMIT 1
      ),
      s.brand_id
    ),
    category_size_id = CASE
      WHEN s.category_size_id IS NULL THEN NULL
      ELSE (
        SELECT new_cs.id
        FROM public.category_size old_cs
        JOIN public.category_size new_cs
          ON new_cs.category_id = trainers_id
         AND LOWER(TRIM(new_cs.size_label)) = LOWER(TRIM(old_cs.size_label))
        WHERE old_cs.id = s.category_size_id
        LIMIT 1
      )
    END,
    brand_tag_image_id = NULL
  WHERE s.category_id IN (
    SELECT c.id
    FROM public.category c
    JOIN public.department d ON d.id = c.department_id
    WHERE LOWER(TRIM(c.category_name)) = 'shoes'
      AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
  );

  -- Safety: clear sizes that do not belong to Trainers
  UPDATE public.stock AS s
  SET category_size_id = NULL
  WHERE s.category_id = trainers_id
    AND s.category_size_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.category_size cs
      WHERE cs.id = s.category_size_id
        AND cs.category_id = trainers_id
    );

  SELECT COUNT(*)::int INTO remaining
  FROM public.stock
  WHERE category_id IN (
    SELECT c.id
    FROM public.category c
    JOIN public.department d ON d.id = c.department_id
    WHERE LOWER(TRIM(c.category_name)) = 'shoes'
      AND LOWER(TRIM(d.department_name)) IN ('menswear', 'womenswear')
  );

  SELECT COUNT(*)::int INTO trainers_stock
  FROM public.stock
  WHERE category_id = trainers_id;

  SELECT COUNT(*)::int INTO brand_count
  FROM public.brand
  WHERE department_id = shoes_dept_id
    AND category_id IS NULL;

  SELECT COUNT(*)::int INTO size_count
  FROM public.category_size
  WHERE category_id = trainers_id;

  RAISE NOTICE 'Stock still on old Shoes categories: % (expect 0)', remaining;
  RAISE NOTICE 'Stock now on Shoes/Trainers: %', trainers_stock;
  RAISE NOTICE 'Shoes department brands: %', brand_count;
  RAISE NOTICE 'Trainers sizes: %', size_count;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Migration incomplete: % stock rows still on source Shoes categories', remaining;
  END IF;
END $$;

-- Optional verification (run after):
-- SELECT d.department_name, c.category_name, COUNT(s.id) AS stock_count
-- FROM category c
-- JOIN department d ON d.id = c.department_id
-- LEFT JOIN stock s ON s.category_id = c.id
-- WHERE d.department_name ILIKE 'shoes'
--    OR (c.category_name ILIKE 'shoes' AND d.department_name ILIKE ANY (ARRAY['menswear','womenswear']))
-- GROUP BY d.department_name, c.category_name
-- ORDER BY d.department_name, c.category_name;
