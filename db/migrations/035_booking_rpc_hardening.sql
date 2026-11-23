-- ============================================================================
-- DATEVRA Migration 035: Hardened Booking RPCs & Consistent Paired Invitation
-- Cancellation
--
-- Prerequisites:
--   - Migrations 001–030 applied (public.date_bookings, public.is_admin(),
--     public.blocked_pair(uuid, uuid), public.lock_matchmaking_pair(uuid, uuid),
--     public.validate_date_offer_schedule(text, text),
--     public.date_invitations, public.date_invitation_recipients).
--
-- Context:
--   - public.date_bookings grants SELECT only to authenticated.
--   - anon and PUBLIC have zero privileges on public.date_bookings.
--   - postgres and service_role retain full privileges.
--   - Existing RLS policies (bookings_select_participants, bookings_admin_write)
--     remain intact and are NOT weakened.
--
-- What this migration adds/updates:
--   1. Re-affirms strict SELECT-only table privileges on public.date_bookings
--      for authenticated (and zero privileges for anon/PUBLIC).
--   2. public.admin_create_booking(...):
--      Authenticated SECURITY DEFINER RPC replacing direct client INSERT on
--      public.date_bookings. Verifies auth.uid() and public.is_admin()
--      server-side, acquires public.lock_matchmaking_pair() for paired bookings,
--      blocks duplicate active bookings (status IN ('pending','confirmed','upcoming')),
--      validates inputs/FKs/blocks/schedule, inserts into public.date_bookings,
--      and writes an admin audit entry to public.activity_logs.
--   3. public.admin_set_booking_status(...):
--      Authenticated SECURITY DEFINER RPC replacing direct client UPDATE on
--      public.date_bookings. Verifies auth.uid() and public.is_admin()
--      server-side, acquires public.lock_matchmaking_pair() before row lock,
--      validates status transitions (preventing resurrection of terminal
--      completed/cancelled bookings), notifies both participants on cancellation,
--      and writes an admin audit entry to public.activity_logs.
--   4. Updates public.admin_cancel_date_invitation(uuid) and
--      public.respond_to_date_invitation(uuid, boolean) so every paired
--      invitation cancellation path (admin cancel, blocked pair, active booking
--      conflict, and partner decline) updates BOTH recipients consistently
--      under the canonical lock order.
--
-- Non-destructive & idempotent: safe to re-run on existing Datevra databases.
-- ============================================================================

-- ============================================================================
-- 1. RE-AFFIRM LEAST-PRIVILEGE GRANTS ON public.date_bookings (DO NOT WEAKEN)
-- ============================================================================

ALTER TABLE public.date_bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.date_bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.date_bookings TO authenticated;
GRANT ALL ON TABLE public.date_bookings TO postgres, service_role;

-- ============================================================================
-- 2. ADMIN BOOKING CREATION RPC (REPLACES DIRECT CLIENT INSERT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_booking(
  p_user_id        uuid,
  p_partner_id     uuid,
  p_experience_id  text,
  p_cafe_id        text DEFAULT NULL,
  p_date           text DEFAULT NULL,
  p_time           text DEFAULT NULL,
  p_venue          text DEFAULT '',
  p_status         text DEFAULT 'confirmed',
  p_amount         integer DEFAULT 0,
  p_payment_status text DEFAULT 'pending'
)
RETURNS public.date_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id            uuid := auth.uid();
  v_a                   uuid;
  v_b                   uuid;
  v_exp_id              text := NULLIF(btrim(COALESCE(p_experience_id, '')), '');
  v_cafe_id             text := NULLIF(btrim(COALESCE(p_cafe_id, '')), '');
  v_date                text := btrim(COALESCE(p_date, ''));
  v_time                text := btrim(COALESCE(p_time, ''));
  v_venue               text;
  v_status              text := lower(btrim(COALESCE(p_status, 'confirmed')));
  v_payment_status      text := lower(btrim(COALESCE(p_payment_status, 'pending')));
  v_amount              integer := COALESCE(p_amount, 0);
  v_existing_booking_id uuid;
  v_booking             public.date_bookings%ROWTYPE;
BEGIN
  -- Strict server-side authentication & admin authorization
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER: Primary member is required.';
  END IF;

  IF p_partner_id IS NOT NULL AND p_user_id = p_partner_id THEN
    RAISE EXCEPTION 'INVALID_PAIR: Booking participants must be two distinct members.';
  END IF;

  IF v_exp_id IS NULL THEN
    RAISE EXCEPTION 'EXPERIENCE_REQUIRED: A valid curated experience is required.';
  END IF;

  -- Validate calendar date, clock time, and reject past dates / past times today
  PERFORM public.validate_date_offer_schedule(v_date, v_time);

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: Booking amount must be zero or greater.';
  END IF;

  -- Preserve existing client mapping ('upcoming' -> 'confirmed') and validate status
  IF v_status = 'upcoming' THEN
    v_status := 'confirmed';
  END IF;
  IF v_status NOT IN ('pending', 'confirmed', 'upcoming') THEN
    RAISE EXCEPTION 'INVALID_STATUS: New bookings must start in pending, confirmed, or upcoming status.';
  END IF;

  -- Normalize UI label 'paid' to live CHECK value 'verified'
  IF v_payment_status = 'paid' THEN
    v_payment_status := 'verified';
  END IF;
  IF v_payment_status NOT IN ('pending', 'verified', 'failed', 'refunded') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Unsupported payment status "%".', p_payment_status;
  END IF;

  -- Canonical Lock Order Step 1: advisory pair lock before row checks/inserts
  IF p_partner_id IS NOT NULL THEN
    v_a := LEAST(p_user_id, p_partner_id);
    v_b := GREATEST(p_user_id, p_partner_id);

    PERFORM public.lock_matchmaking_pair(v_a, v_b);

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_a)
       OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_b) THEN
      RAISE EXCEPTION 'PROFILE_NOT_FOUND: Both booking participants must exist.';
    END IF;

    IF public.blocked_pair(v_a, v_b) THEN
      RAISE EXCEPTION 'PAIR_BLOCKED: Cannot create a booking between blocked members.';
    END IF;

    -- Prevent duplicate active bookings for the same pair inside the locked transaction
    SELECT b.id INTO v_existing_booking_id
    FROM public.date_bookings b
    WHERE b.status IN ('pending', 'confirmed', 'upcoming')
      AND (
        (b.user_id = v_a AND b.partner_id = v_b)
        OR (b.user_id = v_b AND b.partner_id = v_a)
      )
    ORDER BY b.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_existing_booking_id IS NOT NULL THEN
      RAISE EXCEPTION 'ACTIVE_BOOKING_EXISTS: An active booking (%) already exists for this pair.', v_existing_booking_id;
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('datevra:solo_booking:' || p_user_id::text));

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
      RAISE EXCEPTION 'PROFILE_NOT_FOUND: Selected member does not exist.';
    END IF;
  END IF;

  -- Validate foreign keys
  IF NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = v_exp_id) THEN
    RAISE EXCEPTION 'EXPERIENCE_NOT_FOUND: Selected experience does not exist.';
  END IF;

  IF v_cafe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = v_cafe_id) THEN
    RAISE EXCEPTION 'CAFE_NOT_FOUND: Selected café does not exist.';
  END IF;

  -- Resolve venue from cafe if omitted
  v_venue := NULLIF(btrim(COALESCE(p_venue, '')), '');
  IF v_venue IS NULL AND v_cafe_id IS NOT NULL THEN
    SELECT name || ', ' || city INTO v_venue FROM public.cafes WHERE id = v_cafe_id;
  END IF;
  v_venue := COALESCE(v_venue, 'Curated Venue');

  -- Insert booking (existing trg_notify_on_booking notifies both participants automatically)
  INSERT INTO public.date_bookings (
    user_id, partner_id, experience_id, cafe_id,
    date, time, venue, status, amount, payment_status
  ) VALUES (
    p_user_id, p_partner_id, v_exp_id, v_cafe_id,
    v_date, v_time, v_venue, v_status, v_amount, v_payment_status
  )
  RETURNING * INTO v_booking;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'booking.create',
    'Booking ' || v_booking.id::text || ' at ' || v_booking.venue || ' on ' || v_booking.date
  );

  RETURN v_booking;
END;
$$;

COMMENT ON FUNCTION public.admin_create_booking(uuid, uuid, text, text, text, text, text, text, integer, text) IS
  'Admin-only SECURITY DEFINER RPC to create a curated date booking under canonical pair lock with duplicate active-booking protection.';

REVOKE ALL ON FUNCTION public.admin_create_booking(uuid, uuid, text, text, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_booking(uuid, uuid, text, text, text, text, text, text, integer, text) TO authenticated;

-- ============================================================================
-- 3. ADMIN BOOKING STATUS UPDATE RPC (REPLACES DIRECT CLIENT UPDATE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_booking_status(
  p_booking_id uuid,
  p_status     text
)
RETURNS public.date_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_status     text := lower(btrim(COALESCE(p_status, '')));
  v_user_id    uuid;
  v_partner_id uuid;
  v_booking    public.date_bookings%ROWTYPE;
BEGIN
  -- Strict server-side authentication & admin authorization
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking ID is required.';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed', 'upcoming', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Unsupported booking status "%".', p_status;
  END IF;

  -- Lightweight pre-lookup for canonical pair lock ordering
  SELECT user_id, partner_id INTO v_user_id, v_partner_id
  FROM public.date_bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking not found.';
  END IF;

  -- Canonical Lock Order Step 1: advisory pair lock precedes row FOR UPDATE lock
  IF v_partner_id IS NOT NULL THEN
    PERFORM public.lock_matchmaking_pair(v_user_id, v_partner_id);
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext('datevra:solo_booking:' || v_user_id::text));
  END IF;

  -- Canonical Lock Order Step 2: row-level lock on booking
  SELECT * INTO v_booking
  FROM public.date_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: Booking not found.';
  END IF;

  -- Idempotent exit if already in requested status
  IF v_booking.status = v_status THEN
    RETURN v_booking;
  END IF;

  -- Prevent reopening terminal bookings (protects active-booking uniqueness invariant)
  IF v_booking.status IN ('completed', 'cancelled')
     AND v_status IN ('pending', 'confirmed', 'upcoming') THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: Cannot transition a % booking to %.', v_booking.status, v_status;
  END IF;

  UPDATE public.date_bookings
     SET status = v_status,
         updated_at = now()
   WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  -- Notify both participants immediately when an admin cancels a booking
  IF v_status = 'cancelled' THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    SELECT uid,
           'booking',
           'Booking cancelled',
           'Your booking at ' || v_booking.venue || ' on ' || v_booking.date || ' at ' || v_booking.time || ' has been cancelled.',
           '/bookings',
           false
    FROM unnest(ARRAY[v_booking.user_id, v_booking.partner_id]) AS uid
    WHERE uid IS NOT NULL;
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'booking.status',
    'Booking ' || v_booking.id::text || ' → ' || v_status
  );

  RETURN v_booking;
END;
$$;

COMMENT ON FUNCTION public.admin_set_booking_status(uuid, text) IS
  'Admin-only SECURITY DEFINER RPC to update booking lifecycle status under canonical pair lock with cancellation notifications and audit logging.';

REVOKE ALL ON FUNCTION public.admin_set_booking_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_status(uuid, text) TO authenticated;

-- ============================================================================
-- 4. CONSISTENT PAIRED INVITATION CANCELLATION (UPDATES BOTH RECIPIENTS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_date_invitation(
  p_invitation_id uuid
)
RETURNS public.date_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_mode     text;
  v_pair_a   uuid;
  v_pair_b   uuid;
  v_inv      public.date_invitations%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- Lightweight pre-lookup for canonical pair lock ordering on paired invitations
  SELECT i.invitation_mode,
         (
           SELECT r.user_id
           FROM public.date_invitation_recipients r
           WHERE r.invitation_id = i.id
           ORDER BY r.user_id ASC
           LIMIT 1
         ),
         (
           SELECT r.partner_user_id
           FROM public.date_invitation_recipients r
           WHERE r.invitation_id = i.id
           ORDER BY r.user_id ASC
           LIMIT 1
         )
    INTO v_mode, v_pair_a, v_pair_b
  FROM public.date_invitations i
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACTIVE: Active invitation not found.';
  END IF;

  -- Canonical Lock Order Step 1: lock canonical pair BEFORE row locks
  IF v_mode = 'pair' AND v_pair_a IS NOT NULL AND v_pair_b IS NOT NULL THEN
    PERFORM public.lock_matchmaking_pair(v_pair_a, v_pair_b);
  END IF;

  -- Canonical Lock Order Step 2: lock invitation row
  SELECT * INTO v_inv
  FROM public.date_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACTIVE: Active invitation not found.';
  END IF;

  -- Canonical Lock Order Step 3: lock recipient rows in deterministic user_id order
  PERFORM 1
  FROM public.date_invitation_recipients
  WHERE invitation_id = p_invitation_id
  ORDER BY user_id ASC
  FOR UPDATE;

  -- Transaction-safe expiry: persist expired state if already overdue
  IF v_inv.status = 'active' AND v_inv.expires_at <= now() THEN
    UPDATE public.date_invitations
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_inv.id
    RETURNING * INTO v_inv;

    UPDATE public.date_invitation_recipients
       SET response = 'expired',
           updated_at = now()
     WHERE invitation_id = v_inv.id
       AND response = 'pending';

    RETURN v_inv;
  END IF;

  IF v_inv.status <> 'active' THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACTIVE: Active invitation not found.';
  END IF;

  UPDATE public.date_invitations
     SET status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  -- For paired invitations, update BOTH recipients consistently so neither row stays pending/accepted
  IF v_inv.invitation_mode = 'pair' THEN
    UPDATE public.date_invitation_recipients
       SET response = 'declined',
           booking_id = NULL,
           responded_at = COALESCE(responded_at, now()),
           updated_at = now()
     WHERE invitation_id = v_inv.id;
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'date_invitation.cancel', 'Cancelled invitation ' || v_inv.id::text || ' (' || v_inv.title || ')');

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_date_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_date_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_date_invitation(
  p_invitation_id uuid,
  p_accept        boolean
)
RETURNS public.date_invitation_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid                 uuid := auth.uid();
  v_mode                text;
  v_partner_id          uuid;
  v_inv                 public.date_invitations%ROWTYPE;
  v_rec                 public.date_invitation_recipients%ROWTYPE;
  v_partner_rec         public.date_invitation_recipients%ROWTYPE;
  v_booking_id          uuid;
  v_existing_booking_id uuid;
  v_venue               text;
  v_a                   uuid;
  v_b                   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'INVALID_RESPONSE: Acceptance decision is required.';
  END IF;

  -- Lightweight pre-lookup for canonical lock ordering on pair invitations
  SELECT i.invitation_mode, r.partner_user_id
    INTO v_mode, v_partner_id
  FROM public.date_invitations i
  LEFT JOIN public.date_invitation_recipients r
    ON r.invitation_id = i.id AND r.user_id = v_uid
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: Invitation not found.';
  END IF;

  -- Canonical Lock Order Step 1: for pair invitations, lock canonical pair BEFORE row locks
  IF v_mode = 'pair' AND v_partner_id IS NOT NULL THEN
    PERFORM public.lock_matchmaking_pair(v_uid, v_partner_id);
  END IF;

  -- Canonical Lock Order Step 2: lock invitation row
  SELECT * INTO v_inv
  FROM public.date_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: Invitation not found.';
  END IF;

  -- Canonical Lock Order Step 3: lock recipient rows in deterministic user_id order
  IF v_inv.invitation_mode = 'pair' THEN
    PERFORM 1
    FROM public.date_invitation_recipients
    WHERE invitation_id = p_invitation_id
    ORDER BY user_id ASC
    FOR UPDATE;
  END IF;

  SELECT * INTO v_rec
  FROM public.date_invitation_recipients
  WHERE invitation_id = p_invitation_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: You are not an invitee for this invitation.';
  END IF;

  -- Transaction-safe expiry: persist expired state on invitation & pending recipients and return v_rec
  IF v_inv.status = 'active' AND v_inv.expires_at <= now() THEN
    UPDATE public.date_invitations
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_inv.id;

    UPDATE public.date_invitation_recipients
       SET response = 'expired',
           updated_at = now()
     WHERE invitation_id = v_inv.id
       AND response = 'pending';

    SELECT * INTO v_rec
    FROM public.date_invitation_recipients
    WHERE id = v_rec.id;

    RETURN v_rec;
  END IF;

  IF v_inv.status <> 'active' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: This invitation is %.', v_inv.status;
  END IF;

  IF v_rec.response <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded (%) to this invitation.', v_rec.response;
  END IF;

  -- Transaction-safe pair-block handling: cancel paired invitation and update BOTH recipients consistently
  IF v_inv.invitation_mode = 'pair' AND p_accept AND v_rec.partner_user_id IS NOT NULL
     AND public.blocked_pair(v_uid, v_rec.partner_user_id) THEN
    UPDATE public.date_invitations
       SET status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_inv.id;

    UPDATE public.date_invitation_recipients
       SET response = 'declined',
           booking_id = NULL,
           responded_at = COALESCE(responded_at, now()),
           updated_at = now()
     WHERE invitation_id = v_inv.id;

    INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
    VALUES (
      v_uid,
      'system',
      'date_invitation.cancelled_blocked',
      'Cancelled paired invitation ' || v_inv.id::text || ' due to active block between invitees.'
    );

    SELECT * INTO v_rec
    FROM public.date_invitation_recipients
    WHERE id = v_rec.id;

    RETURN v_rec;
  END IF;

  -- If either invitee explicitly declines a paired invitation, cancel it and update BOTH recipients consistently
  IF v_inv.invitation_mode = 'pair' AND NOT p_accept THEN
    UPDATE public.date_invitations
       SET status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_inv.id;

    UPDATE public.date_invitation_recipients
       SET response = 'declined',
           booking_id = NULL,
           responded_at = COALESCE(responded_at, now()),
           updated_at = now()
     WHERE invitation_id = v_inv.id;

    INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
    VALUES (
      v_uid,
      'user',
      'date_invitation.declined_pair',
      'Cancelled paired invitation ' || v_inv.id::text || ' after invitee declined.'
    );

    SELECT * INTO v_rec
    FROM public.date_invitation_recipients
    WHERE id = v_rec.id;

    RETURN v_rec;
  END IF;

  UPDATE public.date_invitation_recipients
     SET response = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now(),
         updated_at = now()
   WHERE id = v_rec.id
  RETURNING * INTO v_rec;

  -- CRITICAL BOOKING RULE (Requirement 5):
  -- Individual or group invitations NEVER auto-create a two-person date_booking.
  -- Only an explicit 'pair' invitation creates strictly one paired booking once BOTH invitees accept.
  IF v_inv.invitation_mode = 'pair' AND p_accept AND v_rec.partner_user_id IS NOT NULL THEN
    SELECT * INTO v_partner_rec
    FROM public.date_invitation_recipients
    WHERE invitation_id = p_invitation_id AND user_id = v_rec.partner_user_id;

    IF FOUND
       AND v_partner_rec.response = 'accepted'
       AND v_rec.booking_id IS NULL
       AND v_partner_rec.booking_id IS NULL THEN
      IF v_inv.experience_id IS NULL THEN
        RAISE EXCEPTION 'EXPERIENCE_REQUIRED: Paired invitation is missing a valid experience.';
      END IF;

      v_a := LEAST(v_uid, v_rec.partner_user_id);
      v_b := GREATEST(v_uid, v_rec.partner_user_id);
      v_venue := COALESCE(NULLIF(btrim(COALESCE(v_inv.venue, '')), ''), 'Curated Venue');

      -- Under the canonical pair advisory lock, check for an existing active booking
      -- (status IN ('pending', 'confirmed', 'upcoming')) before inserting a new one.
      SELECT b.id INTO v_existing_booking_id
      FROM public.date_bookings b
      WHERE b.status IN ('pending', 'confirmed', 'upcoming')
        AND (
          (b.user_id = v_a AND b.partner_id = v_b)
          OR (b.user_id = v_b AND b.partner_id = v_a)
        )
      ORDER BY b.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_existing_booking_id IS NOT NULL THEN
        UPDATE public.date_invitations
           SET status = 'cancelled',
               cancelled_at = now(),
               updated_at = now()
         WHERE id = v_inv.id;

        -- Update BOTH recipients consistently so neither stays 'accepted' on a cancelled invitation
        UPDATE public.date_invitation_recipients
           SET response = 'declined',
               booking_id = NULL,
               responded_at = COALESCE(responded_at, now()),
               updated_at = now()
         WHERE invitation_id = v_inv.id;

        INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
        VALUES (
          v_uid,
          'system',
          'date_invitation.cancelled_active_booking_exists',
          'Cancelled paired invitation ' || v_inv.id::text || ' because active booking ' || v_existing_booking_id::text || ' already exists for this pair.'
        );

        SELECT * INTO v_rec
        FROM public.date_invitation_recipients
        WHERE id = v_rec.id;

        RETURN v_rec;
      END IF;

      INSERT INTO public.date_bookings (
        user_id, partner_id, experience_id, cafe_id,
        date, time, venue, status, amount, payment_status
      ) VALUES (
        v_a, v_b, v_inv.experience_id, v_inv.cafe_id,
        v_inv.date, v_inv.time, v_venue,
        'upcoming', 0, 'pending'
      )
      RETURNING id INTO v_booking_id;

      UPDATE public.date_invitation_recipients
         SET booking_id = v_booking_id,
             updated_at = now()
       WHERE invitation_id = p_invitation_id;

      UPDATE public.date_invitations
         SET status = 'completed',
             updated_at = now()
       WHERE id = p_invitation_id;

      INSERT INTO public.notifications (user_id, kind, title, body, link, read)
      VALUES
        (v_a, 'booking', 'Paired Invitation Confirmed', 'Both invitees accepted! Your date for ' || v_inv.title || ' at ' || v_venue || ' on ' || v_inv.date || ' is confirmed.', '/bookings', false),
        (v_b, 'booking', 'Paired Invitation Confirmed', 'Both invitees accepted! Your date for ' || v_inv.title || ' at ' || v_venue || ' on ' || v_inv.date || ' is confirmed.', '/bookings', false);

      SELECT * INTO v_rec
      FROM public.date_invitation_recipients
      WHERE id = v_rec.id;
    END IF;
  END IF;

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_date_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_date_invitation(uuid, boolean) TO authenticated;
