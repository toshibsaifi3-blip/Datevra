import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getSession as mockGetSession,
  getUser as mockGetUser,
  login as mockLogin,
  logout as mockLogout,
  onEvent as mockOnEvent,
  register as mockRegister,
} from "../lib/mockDb";
import {
  supaGetProfile,
  supaGetUserId,
  supaOnAuthChange,
  supaResendSignupOtp,
  supaSendPasswordReset,
  supaSignIn,
  supaSignOut,
  supaSignUp,
  supaUpdatePassword,
  supaVerifySignupOtp,
  type SupaSignUpInput,
} from "../lib/supabase/auth";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { backendMode, type Session } from "../lib/data";
import type { UserProfile } from "../lib/types";

export type AuthResult =
  | { ok: true; notice?: string }
  | { ok: false; error: string };

interface AuthContextValue {
  session: Session | null;
  user: UserProfile | null;
  isAdmin: boolean;
  ready: boolean;
  mode: "demo" | "supabase";
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (input: SupaSignUpInput) => Promise<AuthResult>;
  verifySignupOtp: (
    email: string,
    token: string,
    profile: Omit<SupaSignUpInput, "email" | "password">,
  ) => Promise<AuthResult>;
  resendSignupOtp: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function supaRole(userId: string): Promise<"user" | "admin"> {
  const c = getSupabase();
  if (!c) return "user";
  const { data } = await c
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin ? "admin" : "user";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const mode = backendMode();

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      const s = mockGetSession();
      setSession(s);
      setUser(s ? (mockGetUser(s.userId) ?? null) : null);
      setReady(true);
      return;
    }
    const uid = await supaGetUserId();
    if (!uid) {
      setSession(null);
      setUser(null);
      setReady(true);
      return;
    }
    const [profile, role] = await Promise.all([supaGetProfile(uid), supaRole(uid)]);
    setSession({ userId: uid, role });
    setUser(profile);
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    if (isSupabaseConfigured) {
      return supaOnAuthChange(() => void refresh());
    }
    const offs = [
      mockOnEvent("auth", () => void refresh()),
      mockOnEvent("profile", () => void refresh()),
      mockOnEvent("payments", () => void refresh()),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) {
        const r = mockLogin(email, password);
        if (r.ok) await refresh();
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }
      const r = await supaSignIn(email, password);
      if (r.ok) await refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Sign-in failed." };
    },
    [refresh],
  );

  const register = useCallback(
    async (input: SupaSignUpInput): Promise<AuthResult> => {
      if (!isSupabaseConfigured) {
        const r = mockRegister(input);
        if (r.ok) await refresh();
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }
      const r = await supaSignUp(input);
      if (!r.ok) return { ok: false, error: r.error ?? "Sign-up failed." };
      if (r.needsVerification) {
        return {
          ok: true,
          notice:
            "Account created — please check your email for the 6-digit verification code.",
        };
      }
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const verifySignupOtp = useCallback(
    async (
      email: string,
      token: string,
      profile: Omit<SupaSignUpInput, "email" | "password">,
    ): Promise<AuthResult> => {
      if (!isSupabaseConfigured) {
        return { ok: false, error: "Email verification needs a live connection." };
      }
      const r = await supaVerifySignupOtp(email, token, profile);
      if (!r.ok) return { ok: false, error: r.error ?? "Verification failed." };
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const resendSignupOtp = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) {
        return { ok: false, error: "Email verification needs a live connection." };
      }
      const r = await supaResendSignupOtp(email);
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Could not resend the code." };
    },
    [],
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      if (!isSupabaseConfigured) {
        return { ok: false, error: "Password update needs a live connection." };
      }
      const r = await supaUpdatePassword(password);
      if (!r.ok) return { ok: false, error: r.error ?? "Could not update password." };
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    if (!isSupabaseConfigured) {
      mockLogout();
    } else {
      await supaSignOut();
    }
    setSession(null);
    setUser(null);
  }, []);

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) {
      // Demo mode has no email provider — honest no-op.
      return {
        ok: true,
        notice: "Password reset is unavailable in offline demo mode.",
      };
    }
    const r = await supaSendPasswordReset(email);
    return r.ok
      ? { ok: true, notice: "If an account exists for this email, a reset link is on its way." }
      : { ok: false, error: r.error ?? "Could not send reset email." };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session, user, isAdmin: session?.role === "admin", ready, mode,
      login, register, verifySignupOtp, resendSignupOtp, updatePassword,
      logout, refresh, sendPasswordReset,
    }),
    [session, user, ready, mode, login, register, verifySignupOtp, resendSignupOtp, updatePassword, logout, refresh, sendPasswordReset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
