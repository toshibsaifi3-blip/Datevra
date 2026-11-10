-- ============================================================================
-- DATEVRA Migration 026: Seed Delhi Partner & Listed Cafés
--
-- PURPOSE:
--   Add the three newly introduced Delhi cafés to the live Supabase database
--   table `public.cafes`:
--     1. Café Hot Stag (id: 'c-hot-stag-del')
--     2. KARMALA CAFE & RESTAURANT (id: 'c-karmala-del')
--     3. The Yumm Club (id: 'c-yumm-club-del')
--
-- SAFETY & IDEMPOTENCY:
--   - Uses `ON CONFLICT (id) DO NOTHING` to ensure existing records are NEVER overwritten.
--   - Safe to execute multiple times without duplicating or altering data.
--   - Protects the 6 original seed cafés:
--       'c-roastery-mum', 'c-lodhi-del', 'c-thirdwave-blr',
--       'c-suzette-pune', 'c-tapri-jpr', 'c-aerocity-hyd'.
--   - Leaves descriptions, booking_info, and opening_hours as empty strings ('')
--     matching the exact verified source records without inventing data.
--   - Primary photo paths point to public assets in the Datevra web deployment.
-- ============================================================================

-- 1. Insert Café Hot Stag
INSERT INTO public.cafes (
  id,
  name,
  city,
  address,
  description,
  image,
  price_range,
  opening_hours,
  experiences,
  booking_info,
  rating,
  partner,
  commission_pct,
  agreement_ref,
  total_bookings,
  revenue
)
VALUES (
  'c-hot-stag-del',
  'Café Hot Stag',
  'Delhi',
  '1st Floor, Opp. Deer Park, Ayyappa Temple Road, Dilshad Garden, Delhi-110095',
  '',
  '/assets/cafes/hot-stag-1.jpg',
  '₹₹',
  '',
  '{}'::text[],
  '',
  0,
  false,
  0,
  NULL,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert KARMALA CAFE & RESTAURANT
INSERT INTO public.cafes (
  id,
  name,
  city,
  address,
  description,
  image,
  price_range,
  opening_hours,
  experiences,
  booking_info,
  rating,
  partner,
  commission_pct,
  agreement_ref,
  total_bookings,
  revenue
)
VALUES (
  'c-karmala-del',
  'KARMALA CAFE & RESTAURANT',
  'Delhi',
  'Tsampa House, 5th Floor, Plot Nos. 18 & 19, Gate No. 3, Majnu Ka Tilla, New Aruna Nagar Colony, Delhi-110054',
  '',
  '/assets/cafes/karmala-1.jpg',
  '₹₹',
  '',
  '{}'::text[],
  '',
  0,
  false,
  0,
  NULL,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;

-- 3. Insert The Yumm Club
INSERT INTO public.cafes (
  id,
  name,
  city,
  address,
  description,
  image,
  price_range,
  opening_hours,
  experiences,
  booking_info,
  rating,
  partner,
  commission_pct,
  agreement_ref,
  total_bookings,
  revenue
)
VALUES (
  'c-yumm-club-del',
  'The Yumm Club',
  'Delhi',
  'Shop no-G5, Aditya Arcade, C Block, Preet Vihar, Delhi, 110092',
  '',
  '/assets/cafes/yumm-club-1.jpg',
  '₹₹',
  '',
  '{}'::text[],
  '',
  0,
  false,
  0,
  NULL,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;
