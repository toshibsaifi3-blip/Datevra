import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client. Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 * When not configured, the app runs in demo mode against a local
 * data adapter (see mockDb.ts) with identical call shapes.
 *
 * NEVER put service-role keys or payment secrets in frontend code.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Public Supabase project URL / anon key (safe for browser use). */
export const SUPABASE_URL = url ?? "";
export const SUPABASE_ANON_KEY = anonKey ?? "";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured || !url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export const RAZORPAY_TEST_MODE =
  (import.meta.env.VITE_RAZORPAY_TEST_MODE as string | undefined) !== "false";
export const RAZORPAY_KEY_ID =
  (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined) ?? "";
