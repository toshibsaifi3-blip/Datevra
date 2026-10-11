import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Field, Logo, inputCls } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

const DEMOS = [
  { label: "Member", email: "demo@datevra.in", password: "demo1234" },
  { label: "Admin", email: "admin@datevra.in", password: "admin1234" },
];

export default function Login() {
  const { login, session } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      navigate(session.role === "admin" ? "/admin" : "/app", { replace: true });
    }
  }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await login(email.trim(), password);
      if (!r.ok) {
        setError(r.error);
      }
      // on success the session effect above navigates
    } finally {
      setBusy(false);
    }
  };

  const fill = (d: { email: string; password: string }) => {
    setEmail(d.email);
    setPassword(d.password);
    setError("");
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
          <h1 className="font-display text-3xl text-ivory mt-6">Welcome back</h1>
          <p className="text-sm text-ivory-dim/80 mt-2">Your story was waiting for you.</p>
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
          <Field label="Password">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
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
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link to="/forgot" className="text-mist hover:text-champagne transition-colors">
              Forgot password?
            </Link>
            <Link to="/register" className="text-champagne hover:text-rosegold transition-colors">
              Create account →
            </Link>
          </div>
        </form>

        <div className="mt-6 glass rounded-2xl p-5">
          <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist mb-3">
            Demo access — tap to fill
          </p>
          <div className="flex gap-2.5">
            {DEMOS.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => fill(d)}
                className="btn-ghost rounded-full px-5 py-2.5 text-xs flex-1"
              >
                {d.label}
                <span className="block text-mist/70 mt-0.5 font-mono">{d.email}</span>
              </button>
            ))}
          </div>
          <p className="text-[0.7rem] text-mist/60 mt-3 font-mono">
            member: demo@datevra.in / demo1234 · admin: admin@datevra.in / admin1234
          </p>
        </div>

        <p className="text-center mt-6">
          <Link to="/" className="text-xs text-mist hover:text-ivory transition-colors">
            ← Back to home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
