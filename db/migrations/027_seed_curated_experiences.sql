-- ============================================================================
-- DATEVRA Migration 027: Seed Curated Experiences for Delhi Partner Cafés
-- (Production Hardened, Non-destructive, Strict Validation, Safe Idempotent)
--
-- PURPOSE:
--   Inserts the 4 curated date experiences offered at Café Hot Stag and
--   Karma La Cafe into `public.experiences` to satisfy the foreign key constraint
--   `date_applications_experience_id_fkey` on `public.date_applications`.
--
-- STRICT PREFLIGHT & TRANSACTIONAL SAFETY:
--   1. Whole-transaction encapsulation: Wrapped in BEGIN ... COMMIT so that any
--      preflight failure or validation exception immediately rolls back all changes.
--   2. Required Table & Column Preflight: Verifies tables ('experiences', 'cafes',
--      'date_applications') and exact columns ('price_from', 'duration_mins',
--      'experiences') exist. Aborts on missing prerequisites.
--   3. Required Café Preflight: Aborts with EXCEPTION if either partner café
--      ('c-hot-stag-del' or 'c-karmala-del') does NOT exist in `public.cafes`.
--   4. Pre-existing Experience Record Title Validation: If any of the 4 target IDs
--      already exist in `public.experiences`, verifies that their titles match
--      the approved titles. Aborts with EXCEPTION if an existing ID has an
--      unexpected title. Never mutates or overwrites existing experience rows.
--   5. Non-destructive Experience Insertion: Uses `ON CONFLICT (id) DO NOTHING`.
--   6. Order-Preserving Café Experience Appends: Preserves every existing entry in
--      its original sequence, appending only missing approved titles without duplicates.
--   7. No Constraint Weakening: Leaves foreign keys and check constraints intact.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  -- 1. Preflight check: verify required tables exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'experiences'
  ) THEN
    RAISE EXCEPTION 'Migration 027 Aborted: Table public.experiences does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cafes'
  ) THEN
    RAISE EXCEPTION 'Migration 027 Aborted: Table public.cafes does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'date_applications'
  ) THEN
    RAISE EXCEPTION 'Migration 027 Aborted: Table public.date_applications does not exist.';
  END IF;

  -- 2. Preflight check: verify required columns exist
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
    RAISE EXCEPTION 'Migration 027 Aborted: Required columns missing in public.experiences or public.cafes.';
  END IF;

  -- 3. Required Café Preflight: Abort if either partner café does not exist
  IF NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = 'c-hot-stag-del') THEN
    RAISE EXCEPTION 'Migration 027 Aborted: Required partner café c-hot-stag-del not found in public.cafes. Please ensure Migration 026 has been executed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = 'c-karmala-del') THEN
    RAISE EXCEPTION 'Migration 027 Aborted: Required partner café c-karmala-del not found in public.cafes. Please ensure Migration 026 has been executed.';
  END IF;

  -- 4. Pre-existing Experience Title Validation: Abort if existing ID has conflicting title
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
      RAISE EXCEPTION 'Migration 027 Aborted: Existing record e-hotstag-premium-date has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-hotstag-coffee-date' AND v_rec.title <> 'Premium Coffee Date' THEN
      RAISE EXCEPTION 'Migration 027 Aborted: Existing record e-hotstag-coffee-date has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-hotstag-italian' AND v_rec.title <> 'Italian Cuisine Date with Premium Experience' THEN
      RAISE EXCEPTION 'Migration 027 Aborted: Existing record e-hotstag-italian has unexpected title "%"', v_rec.title;
    ELSIF v_rec.id = 'e-karmala-karaoke' AND v_rec.title <> 'Premium Date with Live Karaoke' THEN
      RAISE EXCEPTION 'Migration 027 Aborted: Existing record e-karmala-karaoke has unexpected title "%"', v_rec.title;
    END IF;
  END LOOP;

END $$;

-- ============================================================================
-- STEP 1: Insert the 4 curated date experiences (ONLY when ID does not exist)
-- ============================================================================
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

-- ============================================================================
-- STEP 2: Preserve existing café experience array ordering and append only
--         missing approved experience titles without duplicates
-- ============================================================================

-- Café Hot Stag: preserve existing order, append only missing approved titles
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

-- Karma La Cafe: preserve existing order, append only missing approved title
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

-- ============================================================================
-- POST-MIGRATION VERIFICATION QUERIES (Safe read-only audit)
-- ============================================================================

-- 1. Verify all 4 required experiences exist with correct metadata
SELECT id, title, kind, city, price_from, duration_mins, elite_only
FROM public.experiences
WHERE id IN (
  'e-hotstag-premium-date',
  'e-hotstag-coffee-date',
  'e-hotstag-italian',
  'e-karmala-karaoke'
)
ORDER BY id;

-- 2. Verify foreign key validity against date_applications table definition
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'date_applications'
  AND kcu.column_name = 'experience_id';

-- 3. Verify café experience titles are attached without duplicates
SELECT id, name, experiences
FROM public.cafes
WHERE id IN ('c-hot-stag-del', 'c-karmala-del');
