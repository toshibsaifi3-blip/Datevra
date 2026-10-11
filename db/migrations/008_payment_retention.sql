-- =====================================================================
-- DATEVRA migration 008 — retain anonymized financial records (audit fix)
--
-- DECISION (accounting):
--   On account deletion, payment and subscription rows are RETAINED but
--   ANONYMIZED (user_id → NULL) instead of deleted. Rationale:
--     - Tax / accounting audit requirements need the financial trail
--       (amounts, dates, plan, Razorpay references) to survive.
--     - GDPR-style erasure is satisfied: no row can be linked back to the
--       deleted person (profile, email, and all personal data are gone).
--     - Razorpay retains its own compliant transaction records as well.
--   Revenue reports and the admin payments ledger keep working; deleted
--   members simply show as "—" (the UI already falls back gracefully).
--
-- CHANGES (additive, re-runnable):
--   - payments.user_id / subscriptions.user_id become nullable.
--   - FKs change from ON DELETE CASCADE to ON DELETE SET NULL.
--   - delete_own_account() is unchanged — the FK behavior now preserves
--     the rows automatically.
--
-- Apply AFTER 001–007. Re-runnable.
-- =====================================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON FUNCTION public.delete_own_account() IS
  'GDPR-style erasure: the caller''s auth.users row is deleted, cascading to all personal data. Payment and subscription rows are RETAINED with user_id anonymized to NULL for accounting/audit (see migration 008). Only the caller''s own account can be deleted.';
