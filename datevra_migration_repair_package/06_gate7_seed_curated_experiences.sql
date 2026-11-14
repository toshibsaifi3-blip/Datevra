-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 7: Conditional Curated Experiences Seed
-- File: datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql
--
-- PURPOSE:
--   Safely seed the 4 curated Delhi experiences offered at Café Hot Stag
--   ('c-hot-stag-del') and KARMALA CAFE & RESTAURANT ('c-karmala-del'),
--   and attach missing titles to public.cafes.experiences without duplicates.
--
-- NOTE ON MIGRATION 026 & REALTIME:
--   - db/migrations/026_seed_delhi_cafes.sql is SKIP (DO NOT RUN): historical
--     baseline already showed c-hot-stag-del, c-karmala-del, and c-yumm-club-del.
--   - db/realtime_setup.sql is NOT bundled here; run it separately ONLY if
--     Preflight Section 12 indicates any of the 8 core tables are NOT_INCLUDED.
--
-- STRICT EXACT-MATCH VS FAIL-ON-MISMATCH SAFETY:
--   Unlike raw ON CONFLICT (id) DO NOTHING (which would silently preserve wrong
--   data if an existing row drifted), this script checks ALL 10 seeded columns
--   (title, kind, city, description, image, price_from, duration_mins,
--    eligibility, slots, elite_only) on any pre-existing target ID and raises
--   a detailed EXCEPTION if ANY field mismatches.
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Re-running succeeds cleanly ONLY when existing
--   records match the exact approved seed values.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cafe_hotstag  record;
  v_cafe_karmala  record;
  v_seed          record;
  v_existing      public.experiences%ROWTYPE;
BEGIN
  -- 1. Required table & column preconditions
  IF to_regclass('public.experiences') IS NULL
     OR to_regclass('public.cafes') IS NULL
     OR to_regclass('public.date_applications') IS NULL THEN
    RAISE EXCEPTION 'GATE7_PRECONDITION_FAILED: Required tables (experiences, cafes, date_applications) do not exist.';
  END IF;

  -- 2. Confirm partner cafés exist with expected identities
  SELECT id, name, city INTO v_cafe_hotstag FROM public.cafes WHERE id = 'c-hot-stag-del';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GATE7_PRECONDITION_FAILED: Partner café c-hot-stag-del not found in public.cafes.';
  END IF;
  IF v_cafe_hotstag.name <> 'Café Hot Stag' OR v_cafe_hotstag.city <> 'Delhi' THEN
    RAISE EXCEPTION 'GATE7_PRECONDITION_FAILED: c-hot-stag-del identity mismatch (name=%, city=%).', v_cafe_hotstag.name, v_cafe_hotstag.city;
  END IF;

  SELECT id, name, city INTO v_cafe_karmala FROM public.cafes WHERE id = 'c-karmala-del';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GATE7_PRECONDITION_FAILED: Partner café c-karmala-del not found in public.cafes.';
  END IF;
  IF v_cafe_karmala.name <> 'KARMALA CAFE & RESTAURANT' OR v_cafe_karmala.city <> 'Delhi' THEN
    RAISE EXCEPTION 'GATE7_PRECONDITION_FAILED: c-karmala-del identity mismatch (name=%, city=%).', v_cafe_karmala.name, v_cafe_karmala.city;
  END IF;

  -- 3. Compare every existing target experience ID across ALL 10 fields; insert only missing
  FOR v_seed IN
    SELECT * FROM (
      VALUES
        (
          'e-hotstag-premium-date'::text,
          'Premium Date'::text,
          'Romantic Café'::text,
          'Delhi'::text,
          'An intimate romantic evening at Café Hot Stag, Dilshad Garden — artisanal refreshments, ambient lighting, and reserved corner seating.'::text,
          '/assets/cafes/hot-stag-1.jpg'::text,
          3200::int,
          120::int,
          ARRAY['Verified profile', 'Age 21+']::text[],
          '[]'::jsonb,
          false::boolean
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
    ) AS s(id, title, kind, city, description, image, price_from, duration_mins, eligibility, slots, elite_only)
  LOOP
    SELECT * INTO v_existing
    FROM public.experiences
    WHERE id = v_seed.id;

    IF FOUND THEN
      IF v_existing.title IS DISTINCT FROM v_seed.title
         OR v_existing.kind IS DISTINCT FROM v_seed.kind
         OR v_existing.city IS DISTINCT FROM v_seed.city
         OR v_existing.description IS DISTINCT FROM v_seed.description
         OR v_existing.image IS DISTINCT FROM v_seed.image
         OR v_existing.price_from IS DISTINCT FROM v_seed.price_from
         OR v_existing.duration_mins IS DISTINCT FROM v_seed.duration_mins
         OR v_existing.eligibility IS DISTINCT FROM v_seed.eligibility
         OR v_existing.slots IS DISTINCT FROM v_seed.slots
         OR v_existing.elite_only IS DISTINCT FROM v_seed.elite_only THEN
        RAISE EXCEPTION 'GATE7_SEED_CONFLICT: Existing experience % differs from approved seed record (existing title=%, kind=%, price=%, duration=%). Manual inspection required.',
          v_seed.id, v_existing.title, v_existing.kind, v_existing.price_from, v_existing.duration_mins;
      END IF;
    ELSE
      INSERT INTO public.experiences (
        id, title, kind, city, description, image,
        price_from, duration_mins, eligibility, slots, elite_only
      ) VALUES (
        v_seed.id, v_seed.title, v_seed.kind, v_seed.city, v_seed.description, v_seed.image,
        v_seed.price_from, v_seed.duration_mins, v_seed.eligibility, v_seed.slots, v_seed.elite_only
      );
    END IF;
  END LOOP;
END $$;

-- 4. Order-preserving duplicate-free updates to public.cafes.experiences
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
