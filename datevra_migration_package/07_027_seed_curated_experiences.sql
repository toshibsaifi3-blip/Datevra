-- ============================================================================
-- DATEVRA Execution Package File 07 (from 027_seed_curated_experiences.sql)
-- RUN AFTER PREFLIGHT QUERY 5 CONFIRMS PARTNER CAFÉS & ABSENT TARGET IDs.
--
-- Transactional, non-destructive, idempotent seed for the 4 curated Delhi
-- partner café experiences and café experience arrays.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  IF to_regclass('public.experiences') IS NULL THEN
    RAISE EXCEPTION 'Package 07 Aborted: Table public.experiences does not exist.';
  END IF;

  IF to_regclass('public.cafes') IS NULL THEN
    RAISE EXCEPTION 'Package 07 Aborted: Table public.cafes does not exist.';
  END IF;

  IF to_regclass('public.date_applications') IS NULL THEN
    RAISE EXCEPTION 'Package 07 Aborted: Table public.date_applications does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiences' AND column_name = 'price_from'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiences' AND column_name = 'duration_mins'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cafes' AND column_name = 'experiences'
  ) THEN
    RAISE EXCEPTION 'Package 07 Aborted: Required columns missing in public.experiences or public.cafes.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = 'c-hot-stag-del') THEN
    RAISE EXCEPTION 'Package 07 Aborted: Required partner café c-hot-stag-del not found.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = 'c-karmala-del') THEN
    RAISE EXCEPTION 'Package 07 Aborted: Required partner café c-karmala-del not found.';
  END IF;

  FOR v_rec IN (
    SELECT id, title FROM public.experiences
    WHERE id IN (
      'e-hotstag-premium-date',
      'e-hotstag-coffee-date',
      'e-hotstag-italian',
      'e-karmala-karaoke'
    )
  ) LOOP
    IF v_rec.id = 'e-hotstag-premium-date' AND v_rec.title <> 'Premium Date' THEN
      RAISE EXCEPTION 'Package 07 Aborted: Existing e-hotstag-premium-date has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-hotstag-coffee-date' AND v_rec.title <> 'Premium Coffee Date' THEN
      RAISE EXCEPTION 'Package 07 Aborted: Existing e-hotstag-coffee-date has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-hotstag-italian' AND v_rec.title <> 'Italian Cuisine Date with Premium Experience' THEN
      RAISE EXCEPTION 'Package 07 Aborted: Existing e-hotstag-italian has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-karmala-karaoke' AND v_rec.title <> 'Premium Date with Live Karaoke' THEN
      RAISE EXCEPTION 'Package 07 Aborted: Existing e-karmala-karaoke has unexpected title "%"', v_rec.title;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.experiences (
  id,
  title,
  kind,
  city,
  description,
  image,
  price_from,
  duration_mins,
  eligibility,
  slots,
  elite_only
)
VALUES
  (
    'e-hotstag-premium-date',
    'Premium Date',
    'Romantic Café',
    'Delhi',
    'An intimate romantic evening at Café Hot Stag, Dilshad Garden — artisanal refreshments, ambient lighting, and reserved corner seating.',
    '/assets/cafes/hot-stag-1.jpg',
    3200,
    120,
    ARRAY['Verified profile', 'Age 21+'],
    '[]'::jsonb,
    false
  ),
  (
    'e-hotstag-coffee-date',
    'Premium Coffee Date',
    'Coffee Date',
    'Delhi',
    'Handcrafted coffee tasting and conversation for two at Café Hot Stag overlooking the greenery of Deer Park.',
    '/assets/cafes/hot-stag-2.jpg',
    3200,
    90,
    ARRAY['Verified profile', 'Age 21+'],
    '[]'::jsonb,
    false
  ),
  (
    'e-hotstag-italian',
    'Italian Cuisine Date with Premium Experience',
    'Premium Dining',
    'Delhi',
    'A curated multi-course Italian culinary evening at Café Hot Stag — fresh pasta, artisanal pizzas, and dedicated concierge hospitality.',
    '/assets/cafes/hot-stag-3.jpg',
    3200,
    120,
    ARRAY['Verified profile', 'Age 21+'],
    '[]'::jsonb,
    false
  ),
  (
    'e-karmala-karaoke',
    'Premium Date with Live Karaoke',
    'Romantic Café',
    'Delhi',
    'A high-energy romantic evening with live karaoke, signature dining, and scenic 5th-floor views at Karma La Cafe, Majnu Ka Tilla.',
    '/assets/cafes/karmala-1.jpg',
    4500,
    150,
    ARRAY['Verified profile', 'Age 21+'],
    '[]'::jsonb,
    false
  )
ON CONFLICT (id) DO NOTHING;

UPDATE public.cafes
SET experiences = (
  coalesce(experiences, '{}'::text[]) ||
  ARRAY(
    SELECT new_title
    FROM unnest(ARRAY[
      'Premium Date',
      'Premium Coffee Date',
      'Italian Cuisine Date with Premium Experience'
    ]) AS new_title
    WHERE NOT (new_title = ANY(coalesce(experiences, '{}'::text[])))
  )
)
WHERE id = 'c-hot-stag-del';

UPDATE public.cafes
SET experiences = (
  coalesce(experiences, '{}'::text[]) ||
  ARRAY(
    SELECT new_title
    FROM unnest(ARRAY[
      'Premium Date with Live Karaoke'
    ]) AS new_title
    WHERE NOT (new_title = ANY(coalesce(experiences, '{}'::text[])))
  )
)
WHERE id = 'c-karmala-del';

COMMIT;
