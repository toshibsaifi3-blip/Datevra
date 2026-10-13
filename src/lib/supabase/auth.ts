import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "../supabase";
import { mapProfile, unmapPrefs } from "./mappers";
import type { UserProfile } from "../types";

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Set when sign-up succeeded but email verification is still pending. */
  needsVerification?: boolean;
  userId?: string;
}

function client(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return c;
}

export async function supaGetUserId(): Promise<string | null> {
  const { data } = await client().auth.getSession();
  return data.session?.user.id ?? null;
}

export async function supaGetProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await client()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return mapProfile(data as Record<string, unknown>);
}

export async function supaSignIn(
  email: string,
  password: string,
): Promise<AuthResult> {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  const uid = data.user?.id;
  if (!uid) return { ok: false, error: "Sign-in failed. Please try again." };

  // Ensure a profile row exists (defensive: auth user without profile).
  const existing = await supaGetProfile(uid);
  if (!existing) {
    const { error: pErr } = await c.from("profiles").insert({
      id: uid,
      email: data.user?.email ?? email.trim().toLowerCase(),
      first_name: (data.user?.user_metadata?.first_name as string) || "Member",
      age: 18,
      gender: "woman",
      interested_in: "everyone",
      city: "Mumbai",
      profile_complete: 20,
    });
    if (pErr) return { ok: false, error: "Signed in, but your profile could not be loaded. Contact support." };
  }
  return { ok: true, userId: uid };
}

export interface SupaSignUpInput {
  firstName: string;
  email: string;
  password: string;
  age: number;
  gender: UserProfile["gender"];
  interestedIn: UserProfile["interestedIn"];
  city: string;
}

export async function supaSignUp(input: SupaSignUpInput): Promise<AuthResult> {
  const c = client();
  const email = input.email.trim().toLowerCase();
  const { data, error } = await c.auth.signUp({
    email,
    password: input.password,
    options: { data: { first_name: input.firstName } },
  });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  const uid = data.user?.id;
  if (!uid) return { ok: false, error: "Sign-up failed. Please try again." };

  // No session yet → email confirmation is on. Profile row is created
  // on first sign-in (see supaSignIn) once the user verifies.
  if (!data.session) {
    return { ok: true, userId: uid, needsVerification: true };
  }

  const { error: pErr } = await c.from("profiles").insert({
    id: uid,
    email,
    first_name: input.firstName,
    age: input.age,
    gender: input.gender,
    interested_in: input.interestedIn,
    city: input.city,
    profile_complete: 35,
    last_active: new Date().toISOString(),
  });
  if (pErr) {
    await c.auth.signOut();
    return { ok: false, error: "Account created, but the profile could not be saved. Please contact support." };
  }
  await c.from("match_preferences").insert({
    user_id: uid,
    ...unmapPrefs({
      ageMin: 18,
      ageMax: 60,
      interestedIn: "everyone",
      cities: [input.city],
      maxDistanceKm: 50,
      relationshipIntents: [],
      minSharedInterests: 1,
    }),
  });
  return { ok: true, userId: uid };
}

export async function supaSignOut(): Promise<void> {
  await client().auth.signOut();
}

export async function supaSendPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await client().auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    // Land on the in-app recovery page on whichever domain served the app.
    { redirectTo: `${window.location.origin}/reset-password` },
  );
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  return { ok: true };
}

/**
 * Verify the 6-digit email OTP sent at signup. On success Supabase creates
 * a session; we then create the profile + match preferences so the user
 * lands authenticated (mirrors the confirmed-signup branch of supaSignUp).
 */
export async function supaVerifySignupOtp(
  email: string,
  token: string,
  profile: Omit<SupaSignUpInput, "email" | "password">,
): Promise<AuthResult> {
  const c = client();
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await c.auth.verifyOtp({
    email: cleanEmail,
    token: token.trim(),
    type: "signup",
  });
  if (error) return { ok: false, error: friendlyOtpError(error.message) };
  const uid = data.user?.id;
  if (!uid) return { ok: false, error: "Verification failed. Please try again." };

  // Create profile if missing (idempotent — safe on double-verify).
  const existing = await supaGetProfile(uid);
  if (!existing) {
    const { error: pErr } = await c.from("profiles").insert({
      id: uid,
      email: cleanEmail,
      first_name: profile.firstName,
      age: profile.age,
      gender: profile.gender,
      interested_in: profile.interestedIn,
      city: profile.city,
      profile_complete: 35,
      last_active: new Date().toISOString(),
    });
    if (pErr) {
      await c.auth.signOut();
      return { ok: false, error: "Verified, but your profile could not be saved. Please contact support." };
    }
    await c.from("match_preferences").insert({
      user_id: uid,
      ...unmapPrefs({
        ageMin: 18,
        ageMax: 60,
        interestedIn: "everyone",
        cities: [profile.city],
        maxDistanceKm: 50,
        relationshipIntents: [],
        minSharedInterests: 1,
      }),
    });
  }
  return { ok: true, userId: uid };
}

export async function supaResendSignupOtp(email: string): Promise<AuthResult> {
  const { error } = await client().auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
  });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  return { ok: true };
}

/** Set a new password for the currently authenticated (recovery) session. */
export async function supaUpdatePassword(password: string): Promise<AuthResult> {
  const { error } = await client().auth.updateUser({ password });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  return { ok: true };
}

export function supaOnAuthChange(cb: () => void): () => void {
  const { data } = client().auth.onAuthStateChange(() => cb());
  return () => data.subscription.unsubscribe();
}

function friendlyOtpError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("expired") || m.includes("invalid") || m.includes("token"))
    return "That code is invalid or has expired. Please request a new one.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  return message;
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Invalid email or password.";
  if (m.includes("email not confirmed")) return "Please verify your email first — check your inbox for the 6-digit code.";
  if (m.includes("already registered") || m.includes("already exists"))
    return "An account with this email already exists. Try signing in.";
  if (m.includes("password")) return "Password does not meet the requirements.";
  if (m.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  return message;
}
