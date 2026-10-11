-- =====================================================================
-- DATEVRA migration 002 — client parity for the web app
--
-- Closes the gaps between schema 001 and what the Datevra web client
-- needs to drive directly (until the payments Edge Function exists):
--
--   1. Matches: participants may UPDATE compatibility/factors (the client
--      computes the transparent score) and DELETE their own matches
--      (unmatch; cascades to the conversation + messages).
--   2. Admin interim writes: payments, subscriptions, notifications and
--      activity_logs get admin ALL/INSERT policies. These are replaced by
--      service-role Edge Functions in production (payments especially).
--   3. Server-side notifications mirroring the demo backend:
--      - a like notifies the liked user
--      - a message notifies the other participant + bumps
--        conversations.last_message_at
--      - an application status change notifies the applicant
--      - a booking notifies both participants
--
-- Apply AFTER db/schema.sql in the Supabase SQL editor.
-- Re-runnable: every statement is guarded with IF NOT EXISTS / DROP IF EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. matches: participant update + delete
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "matches_update_participants" ON public.matches;
CREATE POLICY "matches_update_participants" ON public.matches
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b)
  WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS "matches_delete_participants" ON public.matches;
CREATE POLICY "matches_delete_participants" ON public.matches
  FOR DELETE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b OR public.is_admin());

-- ---------------------------------------------------------------------
-- 2. admin interim writes (until the payments Edge Function ships)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "payments_admin_write" ON public.payments;
CREATE POLICY "payments_admin_write" ON public.payments
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "subscriptions_admin_write" ON public.subscriptions;
CREATE POLICY "subscriptions_admin_write" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "notifications_admin_write" ON public.notifications;
CREATE POLICY "notifications_admin_write" ON public.notifications
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "logs_admin_insert" ON public.activity_logs;
CREATE POLICY "logs_admin_insert" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- Members may create their own PENDING payment intents (e.g. starting a
-- Razorpay checkout). Only the server/admin may move them to verified.
-- Amount must be positive (blocks zero/negative-amount intent spam).
DROP POLICY IF EXISTS "payments_insert_own_pending" ON public.payments;
CREATE POLICY "payments_insert_own_pending" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending' AND amount > 0);

-- Support email / announcements are safe for members to read.
DROP POLICY IF EXISTS "settings_public_read" ON public.platform_settings;
CREATE POLICY "settings_public_read" ON public.platform_settings
  FOR SELECT TO anon, authenticated USING (true);

-- Members may withdraw their own undecided applications.
DROP POLICY IF EXISTS "applications_cancel_own" ON public.date_applications;
CREATE POLICY "applications_cancel_own" ON public.date_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('submitted','under_review','eligible'))
  WITH CHECK (auth.uid() = user_id AND status = 'cancelled');

-- ---------------------------------------------------------------------
-- 3a. notify the liked user (mirrors demo backend sendLike)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  liker_name text;
BEGIN
  SELECT first_name INTO liker_name FROM public.profiles WHERE id = NEW.from_user_id;
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    NEW.to_user_id,
    'like',
    coalesce(liker_name, 'Someone') || ' liked your profile',
    'Take a look — maybe it''s mutual.',
    '/app/likes'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_like ON public.likes;
CREATE TRIGGER trg_notify_on_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

-- ---------------------------------------------------------------------
-- 3b. notify on message + bump conversation timestamp
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  other_id   uuid;
  sender_name text;
BEGIN
  SELECT p INTO other_id
  FROM unnest(
    (SELECT participant_ids FROM public.conversations WHERE id = NEW.conversation_id)
  ) AS p
  WHERE p <> NEW.sender_id
  LIMIT 1;

  UPDATE public.conversations
  SET last_message_at = NEW.created_at, updated_at = now()
  WHERE id = NEW.conversation_id;

  IF other_id IS NOT NULL THEN
    SELECT first_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      other_id,
      'message',
      'New message from ' || coalesce(sender_name, 'your match'),
      left(NEW.text, 80),
      '/app/chat'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_message ON public.messages;
CREATE TRIGGER trg_notify_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message();

-- ---------------------------------------------------------------------
-- 3c. notify applicant when an admin changes application status
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_application_decision()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  exp_title text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT title INTO exp_title FROM public.experiences WHERE id = NEW.experience_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      NEW.user_id,
      'experience',
      'Application ' || replace(NEW.status, '_', ' '),
      coalesce(exp_title, 'Curated experience') || ' — ' ||
        coalesce(NEW.slot_date, '') || ' at ' || coalesce(NEW.slot_time, ''),
      '/app/applications'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_application ON public.date_applications;
CREATE TRIGGER trg_notify_on_application
  AFTER UPDATE OF status ON public.date_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_application_decision();

-- ---------------------------------------------------------------------
-- 3d. notify both participants when a booking is created
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_booking()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT uid, 'booking', 'Your date is confirmed',
         NEW.venue || ' — ' || NEW.date || ' at ' || NEW.time,
         '/app/bookings'
  FROM unnest(ARRAY[NEW.user_id, NEW.partner_id]) AS uid
  WHERE uid IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_booking ON public.date_bookings;
CREATE TRIGGER trg_notify_on_booking
  AFTER INSERT ON public.date_bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking();
