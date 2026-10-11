-- =====================================================================
-- DATEVRA migration 005 — account deletion + payment hardening
--
-- 1. delete_own_account(): lets a signed-in member permanently delete
--    their own account in a single transaction. The function:
--      - requires auth.uid() (anonymous callers are rejected),
--      - deletes the member's profile-photos Storage objects,
--      - deletes their auth.users row.
--    Deleting auth.users cascades through profiles to likes, passes,
--    matches (→ conversations → messages), notifications, applications,
--    bookings, saved items, blocks, reports, and match_preferences
--    (all ON DELETE CASCADE in db/schema.sql).
--    Financial records are NOT deleted: migration 008 changes the
--    payments/subscriptions FKs to ON DELETE SET NULL, so those rows are
--    retained with user_id anonymized to NULL for accounting/audit.
--    Activity-log rows keep a pseudonymous actor_id (text, no FK) for
--    platform audit; they contain no profile data.
--
-- 2. payments_one_pending_per_user_plan: partial unique index so a
--    member can never hold two pending payments for the same plan —
--    database-level duplicate-transaction prevention backing the
--    create-order Edge Function's idempotency.
--
-- Apply AFTER 001–004. Re-runnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. delete_own_account()
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  -- Profile photos in Storage (no FK — must be explicit).
  DELETE FROM storage.objects
  WHERE bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = v_uid::text;

  -- Cascades: profiles → likes, passes, matches → conversations →
  -- messages, notifications, applications, bookings, saved items,
  -- blocks, reports, match_preferences.
  -- payments/subscriptions are RETAINED (migration 008: ON DELETE SET NULL).
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.delete_own_account() IS
  'GDPR-style erasure: the caller''s auth.users row is deleted, cascading to all personal data. Payment and subscription rows are RETAINED with user_id anonymized to NULL for accounting/audit (see migration 008). Only the caller''s own account can be deleted.';

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. One pending payment per member per plan (duplicate prevention)
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending_per_user_plan
  ON public.payments (user_id, plan_id)
  WHERE status = 'pending';
