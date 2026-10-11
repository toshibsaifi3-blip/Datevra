import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Field, Logo, inputCls, useToast } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

export default function Forgot() {
  const { toast } = useToast();
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const r = await sendPasswordReset(email.trim());
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast(r.notice ?? "If an account exists, a reset link was sent.");
      setEmail("");
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
          <h1 className="font-display text-3xl text-ivory mt-6">Reset your password</h1>
          <p className="text-sm text-ivory-dim/80 mt-2">
            Enter your account email and we'll send you a reset link.
          </p>
        </div>

        <form onSubmit={submit} className="glass-strong rounded-[1.75rem] p-8 space-y-5">
          <Field label="Email address">
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
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
            {busy ? "Sending…" : "Send reset link"}
          </button>

          <p className="text-center text-sm text-mist">
            Remembered it?{" "}
            <Link to="/login" className="text-champagne hover:text-rosegold transition-colors">
              Back to sign in →
            </Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
