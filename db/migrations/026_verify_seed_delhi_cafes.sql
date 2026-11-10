-- ============================================================================
-- DATEVRA: Post-Migration 026 Verification Queries
--
-- PURPOSE:
--   Read-only queries to verify the safe, complete addition of the 3 Delhi cafés
--   to `public.cafes` without altering or removing any existing data.
-- ============================================================================

-- Check 1: Confirm all 3 new café IDs exist with exact names, addresses, and photo paths
SELECT
  id,
  name,
  city,
  address,
  image,
  price_range,
  rating,
  partner
FROM public.cafes
WHERE id IN ('c-hot-stag-del', 'c-karmala-del', 'c-yumm-club-del')
ORDER BY name;

-- Check 2: Confirm all 6 original seed cafés remain completely intact
SELECT
  id,
  name,
  city,
  partner,
  total_bookings,
  revenue
FROM public.cafes
WHERE id IN (
  'c-roastery-mum',
  'c-lodhi-del',
  'c-thirdwave-blr',
  'c-suzette-pune',
  'c-tapri-jpr',
  'c-aerocity-hyd'
)
ORDER BY name;

-- Check 3: Check total café count (should be at least 9)
SELECT
  COUNT(*) AS total_cafes,
  COUNT(*) FILTER (WHERE id IN ('c-hot-stag-del', 'c-karmala-del', 'c-yumm-club-del')) AS new_cafes_count,
  COUNT(*) FILTER (WHERE id IN ('c-roastery-mum', 'c-lodhi-del', 'c-thirdwave-blr', 'c-suzette-pune', 'c-tapri-jpr', 'c-aerocity-hyd')) AS original_cafes_count
FROM public.cafes;
