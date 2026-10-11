-- =====================================================================
-- DATEVRA — Supabase Realtime publication setup
--
-- Enables postgres_changes replication for the tables the web client
-- subscribes to:
--   messages        → live chat delivery
--   notifications   → notification bell / centre updates
--   matches, likes  → discovery + likes + matches screens
--   conversations   → conversation list ordering / unread badges
--   date_applications, date_bookings → member + admin workflow screens
--   profiles        → presence / profile updates
--
-- Typing indicators use Realtime *broadcast* (no table needed).
--
-- Re-runnable: each table is added only if not already a member.
-- Run once in the Supabase SQL editor as the postgres role (or a role
-- that owns the tables). All tables have primary keys, so the default
-- replica identity is sufficient for INSERT/UPDATE/DELETE payloads.
-- =====================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages',
    'notifications',
    'matches',
    'likes',
    'conversations',
    'date_applications',
    'date_bookings',
    'profiles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added public.% to supabase_realtime', t;
    ELSE
      RAISE NOTICE 'public.% already in supabase_realtime, skipping', t;
    END IF;
  END LOOP;
END
$$;
