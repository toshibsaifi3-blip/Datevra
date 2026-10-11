-- ============================================================================
-- DATEVRA Migration 010: Complimentary passes, match proposals, cafe menus
-- ============================================================================
-- Run this in the Supabase SQL Editor. Idempotent — safe to run once.
-- Does NOT modify existing tables' data. Only adds new tables + one column.
-- ============================================================================

-- 1. Add menu column to cafes (if not exists)
ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS menu text NOT NULL DEFAULT '';

-- 2. Complimentary passes
CREATE TABLE IF NOT EXISTS public.complimentary_passes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  cafe_id           uuid NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
  issued_to_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','redeemed','expired','revoked')),
  note              text,
  expires_at        timestamptz,
  redeemed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complimentary_passes_code
  ON public.complimentary_passes(code);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_user
  ON public.complimentary_passes(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_cafe
  ON public.complimentary_passes(cafe_id);

-- 3. Curated match proposals
CREATE TABLE IF NOT EXISTS public.match_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposed_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message             text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired')),
  user_a_response     boolean,
  user_b_response     boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz,
  CHECK (user_a_id <> user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_match_proposals_users
  ON public.match_proposals(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_status
  ON public.match_proposals(status);

-- 4. RLS
ALTER TABLE public.complimentary_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_proposals      ENABLE ROW LEVEL SECURITY;

-- Helper: is the caller an admin?
-- (Uses the existing is_admin() function if present, else checks profiles.)
DO $$
BEGIN
  -- Complimentary passes: admins full access; users read own passes
  DROP POLICY IF EXISTS "passes_admin_all" ON public.complimentary_passes;
  CREATE POLICY "passes_admin_all" ON public.complimentary_passes
    FOR ALL TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = auth.uid() AND p.is_admin = true)
    )
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = auth.uid() AND p.is_admin = true)
    );

  DROP POLICY IF EXISTS "passes_user_read_own" ON public.complimentary_passes;
  CREATE POLICY "passes_user_read_own" ON public.complimentary_passes
    FOR SELECT TO authenticated
    USING (issued_to_user_id = auth.uid());

  -- Match proposals: admins full access; involved users read/update own response
  DROP POLICY IF EXISTS "proposals_admin_all" ON public.match_proposals;
  CREATE POLICY "proposals_admin_all" ON public.match_proposals
    FOR ALL TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = auth.uid() AND p.is_admin = true)
    )
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = auth.uid() AND p.is_admin = true)
    );

  DROP POLICY IF EXISTS "proposals_user_read" ON public.match_proposals;
  CREATE POLICY "proposals_user_read" ON public.match_proposals
    FOR SELECT TO authenticated
    USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

  DROP POLICY IF EXISTS "proposals_user_respond" ON public.match_proposals;
  CREATE POLICY "proposals_user_respond" ON public.match_proposals
    FOR UPDATE TO authenticated
    USING (
      (user_a_id = auth.uid() OR user_b_id = auth.uid())
      AND status = 'pending'
    )
    WITH CHECK (
      (user_a_id = auth.uid() OR user_b_id = auth.uid())
      AND status = 'pending'
    );
END $$;

-- 5. Audit log entries for new actions (if audit_logs table exists)
-- (No schema change needed — app writes via existing audit_logs table.)
