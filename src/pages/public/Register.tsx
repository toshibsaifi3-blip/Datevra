import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Field, Logo, inputCls } from "../../components/ui";
import { CITIES } from "../../data/seed";
import { useAuth } from "../../context/AuthContext";
import type { Gender, InterestedIn } from "../../lib/types";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("woman");
  const [interestedIn, setInterestedIn] = useState<InterestedIn>("everyone");
  const [city, setCity] = useState(CITIES[0]);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return setError("Please tell us your first name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError("Please enter a valid email address.");
    if (password.length < 8)
      return setError("Your password needs at least 8 characters.");
    const ageNum = Number(age);
    if (!age || Number.isNaN(ageNum)) return setError("Please enter your age.");
    if (ageNum < 18) return setError("You must be at least 18 to join Datevra.");
    if (!terms) return setError("Please accept the Terms of Service to continue.");

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await register({
        firstName: firstName.trim(),
        email: email.trim(),
        password,
        age: ageNum,
        gender,
        interestedIn,
        city,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.notice) {
        // Supabase email verification pending — stay here with guidance.
        setNotice(r.notice);
        return;
      }
      navigate("/app", { replace: true });
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
        className="relative w-full max-w-lg"
      >
        <div className="text-center mb-8">
          <Logo size={52} />
          <h1 className="font-display text-3xl text-ivory mt-6">Begin your story</h1>
          <p className="text-sm text-ivory-dim/80 mt-2">
            Free to join · 18+ only · takes two minutes
          </p>
        </div>

        <form onSubmit={submit} className="glass-strong rounded-[1.75rem] p-8 space-y-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="First name">
              <input
                className={inputCls}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Aarav"
                autoComplete="given-name"
              />
            </Field>
            <Field label="Age" hint="Must be 18 or older">
              <input
                className={inputCls}
                type="number"
                min={18}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="25"
              />
            </Field>
          </div>

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

          <Field label="Password" hint="Minimum 8 characters">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
            />
          </Field>

          <div className="grid sm:grid-cols-3 gap-5">
            <Field label="I am">
              <select
                className={inputCls}
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
              >
                <option value="woman">Woman</option>
                <option value="man">Man</option>
                <option value="nonbinary">Non-binary</option>
              </select>
            </Field>
            <Field label="Interested in">
              <select
                className={inputCls}
                value={interestedIn}
                onChange={(e) => setInterestedIn(e.target.value as InterestedIn)}
              >
                <option value="women">Women</option>
                <option value="men">Men</option>
                <option value="everyone">Everyone</option>
              </select>
            </Field>
            <Field label="City">
              <select className={inputCls} value={city} onChange={(e) => setCity(e.target.value)}>
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-start gap-3 text-sm text-ivory-dim/85 cursor-pointer">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-1 accent-[#c97e5f]"
            />
            <span>
              I confirm I am 18 or older and I accept the{" "}
              <Link to="/terms" className="text-champagne hover:text-rosegold">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="text-champagne hover:text-rosegold">
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          {error && (
            <p className="text-sm text-rosegold bg-burgundy/25 border border-burgundy-soft/40 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          {notice && (
            <p className="text-sm text-champagne bg-champagne/10 border border-champagne/30 rounded-xl px-4 py-3">
              {notice}{" "}
              <Link to="/login" className="underline hover:text-rosegold">
                Go to sign in
              </Link>
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-gold rounded-full px-8 py-3.5 text-sm font-semibold w-full disabled:opacity-60"
          >
            {busy ? "Creating your profile…" : "Create my profile"}
          </button>

          <p className="text-center text-sm text-mist">
            Already a member?{" "}
            <Link to="/login" className="text-champagne hover:text-rosegold transition-colors">
              Sign in →
            </Link>
          </p>
        </form>

        <p className="text-center mt-6">
          <Link to="/" className="text-xs text-mist hover:text-ivory transition-colors">
            ← Back to home
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
