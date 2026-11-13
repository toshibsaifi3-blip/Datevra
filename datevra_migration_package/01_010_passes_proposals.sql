-- ============================================================================
-- DATEVRA Execution Package File 01 (from 010_passes_proposals.sql)
-- RUN ONLY AFTER DATEVRA_MIGRATION_PREFLIGHT.sql IS REVIEWED.
--
-- Purpose:
--   Adds cafes.menu, creates public.complimentary_passes and
--   public.match_proposals, configures least-privilege RLS, and creates
--   redeem_pass(text) and respond_to_proposal(uuid, boolean).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cafe_id_type text;
BEGIN
  IF to_regclass('public.cafes') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.conversations') IS NULL
     OR to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Package 01 Aborted: Core 001 tables are missing.';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Package 01 Aborted: public.is_admin() is missing.';
  END IF;

  SELECT data_type INTO v_cafe_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cafes' AND column_name = 'id';

  IF v_cafe_id_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'Package 01 Aborted: public.cafes.id expected type text, got %.', COALESCE(v_cafe_id_type, 'NULL');
  END IF;
END $$;

-- 1. Add menu column to cafes (if not exists)
ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS menu text NOT NULL DEFAULT '';

-- 2. Complimentary passes
CREATE TABLE IF NOT EXISTS public.complimentary_passes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  cafe_id            text NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
  issued_to_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','redeemed','expired','revoked')),
  note               text,
  expires_at         timestamptz,
  redeemed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complimentary_passes_code
  ON public.complimentary_passes(code);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_user
  ON public.complimentary_passes(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_cafe
  ON public.complimentary_passes(cafe_id);

-- 3. Curated match proposals
CREATE TABLE IF NOT EXISTS public.match_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposed_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message              text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','declined','expired')),
  user_a_response      boolean,
  user_b_response      boolean,
  created_at           timestamptz NOT NULL DEFAULT now(),
  responded_at         timestamptz,
  CHECK (user_a_id <> user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_match_proposals_users
  ON public.match_proposals(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_status
  ON public.match_proposals(status);

-- 4. RLS — least privilege: admins manage, users read own rows.
ALTER TABLE public.complimentary_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_proposals      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "passes_admin_all" ON public.complimentary_passes;
  CREATE POLICY "passes_admin_all" ON public.complimentary_passes
    FOR ALL TO authenticated
    USING  (public.is_admin())
    WITH CHECK (public.is_admin());

  DROP POLICY IF EXISTS "passes_user_read_own" ON public.complimentary_passes;
  CREATE POLICY "passes_user_read_own" ON public.complimentary_passes
    FOR SELECT TO authenticated
    USING (issued_to_user_id = auth.uid());

  DROP POLICY IF EXISTS "proposals_admin_all" ON public.match_proposals;
  CREATE POLICY "proposals_admin_all" ON public.match_proposals
    FOR ALL TO authenticated
    USING  (public.is_admin())
    WITH CHECK (public.is_admin());

  DROP POLICY IF EXISTS "proposals_user_read" ON public.match_proposals;
  CREATE POLICY "proposals_user_read" ON public.match_proposals
    FOR SELECT TO authenticated
    USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

  DROP POLICY IF EXISTS "proposals_user_respond" ON public.match_proposals;
END $$;

-- 5. Secure RPCs (SECURITY DEFINER, narrow, atomic)
CREATE OR REPLACE FUNCTION public.redeem_pass(p_code text)
RETURNS public.complimentary_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.complimentary_passes%ROWTYPE;
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'A pass code is required.';
  END IF;

  SELECT * INTO v_pass
  FROM public.complimentary_passes
  WHERE code = btrim(p_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid pass code.';
  END IF;
  IF v_pass.status = 'redeemed' THEN
    RAISE EXCEPTION 'This pass has already been redeemed.';
  END IF;
  IF v_pass.status = 'revoked' THEN
    RAISE EXCEPTION 'This pass has been revoked.';
  END IF;
  IF v_pass.status = 'expired'
     OR (v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now()) THEN
    UPDATE public.complimentary_passes
       SET status = 'expired' WHERE id = v_pass.id;
    RAISE EXCEPTION 'This pass has expired.';
  END IF;
  IF v_pass.issued_to_user_id IS NOT NULL
     AND v_pass.issued_to_user_id <> v_uid THEN
    RAISE EXCEPTION 'This pass was issued to a different account.';
  END IF;

  UPDATE public.complimentary_passes
     SET status = 'redeemed',
         redeemed_at = now(),
         issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
   WHERE id = v_pass.id
  RETURNING * INTO v_pass;

  RETURN v_pass;
END;
$$;

COMMENT ON FUNCTION public.redeem_pass(text) IS
  'Redeem a complimentary pass code. Atomic: row lock prevents double redemption.';

REVOKE ALL ON FUNCTION public.redeem_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_pass(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_proposal(
  p_proposal_id uuid,
  p_accept      boolean
)
RETURNS public.match_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop  public.match_proposals%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_is_a  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_prop
  FROM public.match_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'This proposal is no longer pending.';
  END IF;
  IF v_uid <> v_prop.user_a_id AND v_uid <> v_prop.user_b_id THEN
    RAISE EXCEPTION 'Not authorized for this proposal.';
  END IF;

  v_is_a := (v_uid = v_prop.user_a_id);

  IF v_is_a THEN
    v_prop.user_a_response := p_accept;
  ELSE
    v_prop.user_b_response := p_accept;
  END IF;

  IF NOT p_accept THEN
    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response,
           status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  IF v_prop.user_a_response IS TRUE AND v_prop.user_b_response IS TRUE THEN
    INSERT INTO public.matches (user_a, user_b)
    VALUES (
      LEAST(v_prop.user_a_id, v_prop.user_b_id),
      GREATEST(v_prop.user_a_id, v_prop.user_b_id)
    )
    ON CONFLICT (user_a, user_b) DO NOTHING;

    INSERT INTO public.conversations (match_id, participant_ids)
    SELECT m.id, ARRAY[v_prop.user_a_id, v_prop.user_b_id]
    FROM public.matches m
    WHERE m.user_a = LEAST(v_prop.user_a_id, v_prop.user_b_id)
      AND m.user_b = GREATEST(v_prop.user_a_id, v_prop.user_b_id)
    ON CONFLICT (match_id) DO NOTHING;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES
      (v_prop.user_a_id, 'match', 'Proposal accepted!',
       'You both accepted the curated match proposal. Say hello!', '/matches'),
      (v_prop.user_b_id, 'match', 'Proposal accepted!',
       'You both accepted the curated match proposal. Say hello!', '/matches')
    ON CONFLICT DO NOTHING;

    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response,
           status = 'accepted',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
  ELSE
    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
  END IF;

  RETURN v_prop;
END;
$$;

COMMENT ON FUNCTION public.respond_to_proposal(uuid, boolean) IS
  'Record a user response to a match proposal; creates the match on dual accept.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;

COMMIT;
