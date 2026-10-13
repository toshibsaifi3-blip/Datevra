import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Field, Logo, inputCls } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { getSupabase } from "../../lib/supabase";

/**
 * Completes the password-recovery flow. Supabase redirects the reset link
 * here (see supaSendPasswordReset); supabase-js picks the recovery session
 * up from the URL hash automatically, and this page lets the user choose
 * a new password via auth.updateUser.
 */
export default function ResetPassword() {
  const { updatePassword, session, ready } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    // Give supabase-js a moment to ingest the recovery tokens from the URL.
    const t = setTimeout(async () => {
      try {
        const c = getSupabase();
        const { data } = c ? await c.auth.getSession() : { data: { session: null } };
        setHasRecoverySession(Boolean(data.session));
      } catch {
        setHasRecoverySession(false);
      } finally {
        setChecking(false);
      }
    }, 800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (done && session) {
      const t = setTimeout(
        () => navigate(session.role === "admin" ? "/admin" : "/app", { replace: true }),
        1500,
      );
      return () => clearTimeout(t);
    }
  }, [done, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Your new password needs at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await updatePassword(password);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-16 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(110,27,46,0.35),transparent_65%)]" />
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Logo size={52} />
          <h1 className="font-display text-3xl text-ivory mt-6">Choose a new password</h1>
          <p className="text-sm text-ivory-dim/80 mt-2">
            {done
              ? "Your password has been updated."
              : "Enter a new password for your account."}
          </p>
        </div>

        <div className="glass-strong rounded-[1.75rem] p-8">
          {checking || !ready ? (
            <p className="text-sm text-mist text-center py-6">Verifying your reset link…</p>
          ) : done ? (
            <div className="space-y-5 text-center">
              <p className="text-sm text-champagne bg-champagne/10 border border-champagne/30 rounded-xl px-4 py-3">
                Password updated successfully. Taking you to your account…
              </p>
              <Link to="/login" className="text-sm text-champagne hover:text-rosegold">
                Continue to sign in →
              </Link>
            </div>
          ) : !hasRecoverySession ? (
            <div className="space-y-5 text-center">
              <p className="text-sm text-rosegold bg-burgundy/25 border border-burgundy-soft/40 rounded-xl px-4 py-3">
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <Link to="/forgot" className="text-sm text-champagne hover:text-rosegold">
                Request a new reset link →
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <Field label="New password" hint="Minimum 8 characters">
                <input
                  className={inputCls}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  className={inputCls}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>

              {error && (
                <p className="text-sm text-rosegold bg-burgundy/25 border border-burgundy-soft/40 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="btn-gold rounded-full px-8 py-3.5 text-sm font-semibold w-full disabled:opacity-60"
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center mt-6">
          <Link to="/login" className="text-xs text-mist hover:text-ivory transition-colors">
            ← Back to sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
