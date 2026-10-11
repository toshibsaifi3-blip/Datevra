import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useBackend } from "../../lib/data";
import { ALL_INTERESTS, CITIES, RELATIONSHIP_INTENTS } from "../../data/seed";
import {
  Avatar,
  Badge,
  Field,
  PlanBadge,
  Reveal,
  inputCls,
  useToast,
} from "../../components/ui";
import { useDbRefresh } from "./shared";
import PhotoManager from "../../components/PhotoManager";
import type { Gender, InterestedIn } from "../../lib/types";

const GENDERS: { id: Gender; label: string }[] = [
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
  { id: "nonbinary", label: "Non-binary" },
];

const INTERESTED: { id: InterestedIn; label: string }[] = [
  { id: "women", label: "Women" },
  { id: "men", label: "Men" },
  { id: "everyone", label: "Everyone" },
];

const reduceMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Dreamy photo showcase: elegant crossfade between photos ---------- */
function PhotoShowcase({ photos, name }: { photos: string[]; name: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (idx >= photos.length) setIdx(0);
  }, [photos.length, idx]);

  // Gentle auto-advance, paused for reduced-motion users.
  useEffect(() => {
    if (photos.length < 2 || reduceMotion) return;
    const t = window.setInterval(
      () => setIdx((i) => (i + 1) % photos.length),
      6000,
    );
    return () => window.clearInterval(t);
  }, [photos.length]);

  if (photos.length === 0) {
    return (
      <div className="relative aspect-[4/3] md:aspect-[16/9] overflow-hidden rounded-3xl glass flex flex-col items-center justify-center gap-3 text-center px-6">
        <span className="text-5xl animate-float-slow">✦</span>
        <p className="font-display text-xl text-ivory">Your gallery awaits its first star</p>
        <p className="text-sm text-mist max-w-sm">
          Add a photo below — your first photo becomes your main one in discovery.
        </p>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3] md:aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-coal/60">
      <AnimatePresence mode="wait" initial={false}>
        <motion.img
          key={photos[idx]}
          src={photos[idx]}
          alt={`${name}'s photo ${idx + 1}`}
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-midnight/70 via-transparent to-midnight/30 pointer-events-none" />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {photos.map((p, i) => (
          <button
            key={p}
            type="button"
            aria-label={`Show photo ${i + 1}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === idx
                ? "w-8 bg-gradient-to-r from-rosegold to-champagne"
                : "w-1.5 bg-white/40 hover:bg-white/70"
            }`}
          />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full glass-strong w-10 h-10 flex items-center justify-center text-ivory hover:text-rosegold transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => setIdx((i) => (i + 1) % photos.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full glass-strong w-10 h-10 flex items-center justify-center text-ivory hover:text-rosegold transition-colors"
          >
            ›
          </button>
        </>
      )}
      <span className="absolute top-4 right-4 rounded-full glass-strong px-3 py-1 text-xs text-champagne">
        {idx + 1} / {photos.length}
      </span>
    </div>
  );
}

function SectionTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <p className="text-[0.7rem] uppercase tracking-[0.3em] text-rosegold">{kicker}</p>
      <h2 className="font-display text-2xl text-ivory mt-1">{title}</h2>
      {sub && <p className="text-sm text-mist mt-1.5">{sub}</p>}
    </div>
  );
}

function ChipList({
  items,
  onRemove,
  empty,
  tone,
}: {
  items: string[];
  onRemove: (item: string) => void;
  empty: string;
  tone: "champagne" | "rosegold" | "mist";
}) {
  const toneCls =
    tone === "champagne"
      ? "border-champagne/50 bg-champagne/10 text-champagne"
      : tone === "rosegold"
        ? "border-rosegold/50 bg-rosegold/10 text-rosegold"
        : "border-white/20 bg-white/5 text-ivory-dim";
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {items.map((i) => (
        <motion.button
          key={i}
          type="button"
          onClick={() => onRemove(i)}
          whileTap={{ scale: 0.94 }}
          className={`rounded-full border px-3.5 py-1.5 text-sm transition-all hover:brightness-125 ${toneCls}`}
        >
          {i} <span aria-hidden>×</span>
        </motion.button>
      ))}
      {items.length === 0 && <span className="text-sm text-mist">{empty}</span>}
    </div>
  );
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  useDbRefresh("profiles");

  const [firstName, setFirstName] = useState("");
  const [age, setAge] = useState(25);
  const [city, setCity] = useState(CITIES[0]);
  const [bio, setBio] = useState("");
  const [relationshipIntent, setRelationshipIntent] = useState("");
  const [gender, setGender] = useState<Gender>("woman");
  const [interestedIn, setInterestedIn] = useState<InterestedIn>("everyone");
  const [interests, setInterests] = useState<string[]>([]);
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [lifestyle, setLifestyle] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  const [interestQuery, setInterestQuery] = useState("");
  const [customInterest, setCustomInterest] = useState("");
  const [hobbyInput, setHobbyInput] = useState("");
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync form when the user record changes (e.g. after save).
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName);
    setAge(user.age);
    setCity(user.city);
    setBio(user.bio);
    setRelationshipIntent(user.relationshipIntent);
    setGender(user.gender);
    setInterestedIn(user.interestedIn);
    setInterests(user.interests);
    setHobbies(user.hobbies);
    setLifestyle(user.lifestyle);
    setOnline(user.online);
  }, [user]);

  if (!user) return null;

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const addFree = (
    list: string[],
    set: (v: string[]) => void,
    raw: string,
    clear: () => void,
  ) => {
    const v = raw.trim();
    if (!v) return;
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) {
      set([...list, v]);
    }
    clear();
  };

  const suggestions = ALL_INTERESTS.filter(
    (i) =>
      !interests.includes(i) &&
      i.toLowerCase().includes(interestQuery.trim().toLowerCase()),
  ).slice(0, 12);

  const save = async () => {
    if (!firstName.trim()) {
      toast("Please add your first name.", "rose");
      return;
    }
    if (age < 18 || age > 100) {
      toast("Age must be between 18 and 100.", "rose");
      return;
    }
    setSaving(true);
    try {
      await db.updateUser(user.id, {
        firstName: firstName.trim(),
        age,
        city,
        bio: bio.trim(),
        relationshipIntent,
        gender,
        interestedIn,
        interests,
        hobbies,
        lifestyle,
        online,
      });
      refresh();
      toast("Profile saved.");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't save your profile.",
        "rose",
      );
    } finally {
      setSaving(false);
    }
  };

  const radius = 40;
  const circ = 2 * Math.PI * radius;

  return (
    <div className="relative max-w-4xl mx-auto px-5 py-10">
      {/* dreamy ambience */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-burgundy/30 blur-[120px] animate-aura-shift" />
      <div className="pointer-events-none absolute top-1/3 -right-32 h-80 w-80 rounded-full bg-rosegold/10 blur-[120px]" />
      {[12, 38, 64, 82].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute top-10 text-champagne/30 animate-twinkle"
          style={{ left: `${left}%`, animationDelay: `${i * 0.8}s`, fontSize: `${10 + i * 3}px` }}
        >
          ✦
        </span>
      ))}

      {/* header */}
      <Reveal>
        <div className="glass-strong glow-border rounded-[2rem] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-rosegold/15 blur-[90px]" />
          <div className="relative flex flex-wrap items-center gap-6">
            <div className="relative">
              <Avatar name={firstName || user.firstName} photo={user.photos[0]} size={96} ring />
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-champagne to-rosegold flex items-center justify-center text-midnight text-sm shadow-lg">
                ✦
              </span>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-[0.7rem] uppercase tracking-[0.3em] text-rosegold mb-1">
                Your constellation
              </p>
              <h1 className="font-display text-3xl text-gradient-dream">
                {firstName || user.firstName}, {age}
              </h1>
              <p className="text-sm text-mist mt-1">
                This is how you'll appear in discovery. Be genuine — it works.
              </p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <PlanBadge plan={user.plan} />
                {user.verified && <Badge tone="green">✓ Verified</Badge>}
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <svg width="100" height="100" viewBox="0 0 100 100" aria-label={`${user.profileComplete}% complete`}>
                <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke="url(#dv-prof-dream)"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={circ * (1 - user.profileComplete / 100)}
                  transform="rotate(-90 50 50)"
                />
                <defs>
                  <linearGradient id="dv-prof-dream" x1="0" y1="0" x2="100" y2="100">
                    <stop offset="0%" stopColor="#FF3D9A" />
                    <stop offset="100%" stopColor="#C5A4FF" />
                  </linearGradient>
                </defs>
                <text x="50" y="56" textAnchor="middle" fill="#C5A4FF" fontSize="19" fontWeight="600">
                  {user.profileComplete}%
                </text>
              </svg>
              <span className="text-[0.65rem] uppercase tracking-[0.25em] text-mist">Complete</span>
            </div>
          </div>
        </div>
      </Reveal>

      {/* photo showcase + manager */}
      <Reveal delay={0.05}>
        <section className="mb-8">
          <PhotoShowcase photos={user.photos} name={firstName || user.firstName} />
        </section>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="glass rounded-[2rem] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-burgundy/25 blur-[90px]" />
          <div className="relative">
            <PhotoManager />
          </div>
        </div>
      </Reveal>

      {/* about */}
      <Reveal>
        <section className="glass rounded-[2rem] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-champagne/10 blur-[80px]" />
          <div className="relative">
            <SectionTitle
              kicker="About you"
              title="Write your story"
              sub="A few honest lines — what a great first evening looks like, what you're into."
            />
            <div className="grid md:grid-cols-3 gap-5">
              <Field label="First name">
                <input className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={30} />
              </Field>
              <Field label="Age (18+)">
                <input
                  type="number"
                  className={inputCls}
                  value={age}
                  min={18}
                  max={100}
                  onChange={(e) => setAge(Number(e.target.value))}
                />
              </Field>
              <Field label="City">
                <select className={inputCls} value={city} onChange={(e) => setCity(e.target.value)}>
                  {CITIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Bio" hint="A few honest lines about you — what a great first date looks like, what you're into.">
              <textarea
                className={`${inputCls} min-h-[110px] resize-y`}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={500}
                placeholder="Tell your story…"
              />
            </Field>
          </div>
        </section>
      </Reveal>

      {/* matching preferences */}
      <Reveal>
        <section className="glass rounded-[2rem] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-rosegold/10 blur-[80px]" />
          <div className="relative">
            <SectionTitle
              kicker="Matching preferences"
              title="Who you're hoping to meet"
              sub="These shape your discovery deck and compatibility."
            />
            <div className="grid md:grid-cols-3 gap-5">
              <Field label="I identify as">
                <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                  {GENDERS.map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Interested in">
                <select className={inputCls} value={interestedIn} onChange={(e) => setInterestedIn(e.target.value as InterestedIn)}>
                  {INTERESTED.map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Relationship intent">
                <select className={inputCls} value={relationshipIntent} onChange={(e) => setRelationshipIntent(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  {RELATIONSHIP_INTENTS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </section>
      </Reveal>

      {/* interests, hobbies, lifestyle */}
      <Reveal>
        <section className="glass rounded-[2rem] p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute top-0 left-1/3 h-40 w-40 rounded-full bg-celestial/10 blur-[80px]" />
          <div className="relative space-y-8">
            <SectionTitle
              kicker="Your world"
              title="Interests, hobbies & lifestyle"
              sub="Interests power your compatibility scores — the rest helps our curators seat you well."
            />
            <Field label="Interests" hint="Tap to add. These power your compatibility scores.">
              <ChipList items={interests} onRemove={(i) => toggle(interests, setInterests, i)} empty="None yet — pick a few below." tone="champagne" />
              <input
                className={`${inputCls} mb-2`}
                placeholder="Search interests…"
                value={interestQuery}
                onChange={(e) => setInterestQuery(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <motion.button
                    key={s}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    onClick={() => toggle(interests, setInterests, s)}
                    className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-ivory-dim hover:border-rosegold/50 hover:text-ivory transition-colors"
                  >
                    + {s}
                  </motion.button>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <input
                  className={inputCls}
                  placeholder="Or add your own…"
                  value={customInterest}
                  onChange={(e) => setCustomInterest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFree(interests, setInterests, customInterest, () => setCustomInterest(""));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost rounded-xl px-4 text-sm shrink-0"
                  onClick={() => addFree(interests, setInterests, customInterest, () => setCustomInterest(""))}
                >
                  Add
                </button>
              </div>
            </Field>

            <div className="hairline" />

            <Field label="Hobbies" hint="Things you love doing in your free time.">
              <ChipList items={hobbies} onRemove={(h) => toggle(hobbies, setHobbies, h)} empty="None yet." tone="rosegold" />
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="e.g. Weekend cycling, film photography…"
                  value={hobbyInput}
                  onChange={(e) => setHobbyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFree(hobbies, setHobbies, hobbyInput, () => setHobbyInput(""));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost rounded-xl px-4 text-sm shrink-0"
                  onClick={() => addFree(hobbies, setHobbies, hobbyInput, () => setHobbyInput(""))}
                >
                  Add
                </button>
              </div>
            </Field>

            <div className="hairline" />

            <Field label="Lifestyle" hint="Optional — shared voluntarily. e.g. Early riser, Vegetarian, Non-smoker.">
              <ChipList items={lifestyle} onRemove={(l) => toggle(lifestyle, setLifestyle, l)} empty="None added." tone="mist" />
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Add a lifestyle note…"
                  value={lifestyleInput}
                  onChange={(e) => setLifestyleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFree(lifestyle, setLifestyle, lifestyleInput, () => setLifestyleInput(""));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost rounded-xl px-4 text-sm shrink-0"
                  onClick={() => addFree(lifestyle, setLifestyle, lifestyleInput, () => setLifestyleInput(""))}
                >
                  Add
                </button>
              </div>
            </Field>
          </div>
        </section>
      </Reveal>

      {/* privacy */}
      <Reveal>
        <section className="glass rounded-[2rem] p-6 md:p-8 mb-8">
          <SectionTitle
            kicker="Privacy"
            title="Your presence"
            sub="Control how visible you are while you're here."
          />
          <label className="flex items-center justify-between gap-4 glass rounded-2xl px-5 py-4 cursor-pointer card-hover">
            <div>
              <p className="text-ivory font-medium">Show me as online</p>
              <p className="text-xs text-mist mt-0.5">Matches can see when you're around to chat.</p>
            </div>
            <input
              type="checkbox"
              checked={online}
              onChange={(e) => setOnline(e.target.checked)}
              className="h-5 w-5 accent-[#FF3D9A] shrink-0"
            />
          </label>
        </section>
      </Reveal>

      {/* save */}
      <Reveal>
        <div className="flex justify-end mb-10">
          <motion.button
            onClick={save}
            disabled={saving}
            whileTap={{ scale: 0.97 }}
            className="btn-gold rounded-full px-10 py-3.5 font-medium disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save profile"}
          </motion.button>
        </div>
      </Reveal>

      {/* account controls */}
      <Reveal>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <Link to="/settings" className="glass rounded-3xl p-6 card-hover block relative overflow-hidden">
            <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-rosegold/10 blur-[60px]" />
            <p className="text-[0.7rem] uppercase tracking-[0.25em] text-rosegold mb-2">Account</p>
            <p className="font-display text-xl text-ivory">Settings & data</p>
            <p className="text-sm text-mist mt-1">Notifications, sign-out, and account deletion live here.</p>
          </Link>
          <Link to="/privacy" className="glass rounded-3xl p-6 card-hover block relative overflow-hidden">
            <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-champagne/10 blur-[60px]" />
            <p className="text-[0.7rem] uppercase tracking-[0.25em] text-champagne mb-2">Privacy</p>
            <p className="font-display text-xl text-ivory">How you're seen</p>
            <p className="text-sm text-mist mt-1">Blocking, visibility, and who can find you.</p>
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
