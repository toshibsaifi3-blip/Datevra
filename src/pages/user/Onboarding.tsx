import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useBackend } from "../../lib/data";
import { ALL_INTERESTS, CITIES, RELATIONSHIP_INTENTS } from "../../data/seed";
import {
  Avatar,
  Badge,
  Field,
  Logo,
  inputCls,
  useToast,
} from "../../components/ui";
import PhotoManager from "../../components/PhotoManager";
import { profileCompleteness } from "../../lib/supabase/mappers";
import {
  GENDERS,
  INTERESTED_OPTIONS,
  addCustomTagItem,
  determineInitialOnboardingStep,
  isProfileSetupComplete,
  toggleTag,
  validateBasicIdentity,
  type BasicIdentityErrors,
} from "../../lib/profileFields";
import type { Gender, InterestedIn, UserProfile } from "../../lib/types";

const STEPS = [
  { id: 1, title: "Identity", kicker: "Step 1 of 6" },
  { id: 2, title: "Your Story", kicker: "Step 2 of 6" },
  { id: 3, title: "Intentions", kicker: "Step 3 of 6" },
  { id: 4, title: "Interests", kicker: "Step 4 of 6" },
  { id: 5, title: "Photos", kicker: "Step 5 of 6" },
  { id: 6, title: "Review", kicker: "Step 6 of 6" },
] as const;

export default function Onboarding() {
  const { user, refresh } = useAuth();
  const db = useBackend();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const isResumeMode = searchParams.get("resume") === "1" || searchParams.has("step");
  const requestedStepParam = Number(searchParams.get("step"));
  const hasValidRequestedStep =
    Number.isInteger(requestedStepParam) && requestedStepParam >= 1 && requestedStepParam <= 6;

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [age, setAge] = useState(25);
  const [gender, setGender] = useState<Gender>("woman");
  const [city, setCity] = useState(CITIES[0]);
  const [bio, setBio] = useState("");
  const [interestedIn, setInterestedIn] = useState<InterestedIn>("everyone");
  const [relationshipIntent, setRelationshipIntent] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [lifestyle, setLifestyle] = useState<string[]>([]);
  const [interestQuery, setInterestQuery] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [hobbyInput, setHobbyInput] = useState("");
  const [lifestyleInput, setLifestyleInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<BasicIdentityErrors>({});
  const [error, setError] = useState("");
  const [offlineError, setOfflineError] = useState(false);

  const hydratedUserIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  // Completed members bypass onboarding unless they intentionally came to resume/review
  useEffect(() => {
    if (!user) return;
    if (!isResumeMode && isProfileSetupComplete(user)) {
      navigate("/app", { replace: true });
    }
  }, [user, isResumeMode, navigate]);

  // Hydrate form fields once per authenticated member without overwriting local edits
  useEffect(() => {
    if (!user) return;
    if (hydratedUserIdRef.current === user.id) return;
    hydratedUserIdRef.current = user.id;

    setFirstName(user.firstName || "");
    setAge(user.age >= 18 ? user.age : 18);
    setGender(user.gender || "woman");
    setCity(user.city || CITIES[0]);
    setBio(user.bio || "");
    setInterestedIn(user.interestedIn || "everyone");
    setRelationshipIntent(user.relationshipIntent || "");
    setInterests(user.interests ?? []);
    setHobbies(user.hobbies ?? []);
    setLifestyle(user.lifestyle ?? []);

    if (hasValidRequestedStep) {
      setStep(requestedStepParam);
    } else {
      setStep(determineInitialOnboardingStep(user));
    }
  }, [user, hasValidRequestedStep, requestedStepParam]);

  const currentCompleteness = useMemo(
    () =>
      profileCompleteness({
        bio,
        relationshipIntent,
        city,
        interests,
        photos: user?.photos ?? [],
      }),
    [bio, relationshipIntent, city, interests, user?.photos],
  );

  const presetSuggestions = useMemo(() => {
    const q = interestQuery.trim().toLowerCase();
    return ALL_INTERESTS.filter(
      (tag) => !q || tag.toLowerCase().includes(q),
    ).slice(0, 24);
  }, [interestQuery]);

  if (!user) return null;

  const buildPatchForStep = (currentStep: number): Partial<UserProfile> | null => {
    if (currentStep === 1) {
      return {
        firstName: firstName.trim(),
        age: Number(age),
        gender,
        city,
      };
    }
    if (currentStep === 2) {
      return {
        bio: bio.trim(),
      };
    }
    if (currentStep === 3) {
      return {
        interestedIn,
        relationshipIntent,
      };
    }
    if (currentStep === 4) {
      return {
        interests,
        hobbies,
        lifestyle,
      };
    }
    // Step 5 (photos) persists immediately via PhotoManager; Step 6 is review.
    return null;
  };

  const validateCurrentStep = (currentStep: number): boolean => {
    setError("");
    setFieldErrors({});
    if (currentStep === 1) {
      const errs = validateBasicIdentity(firstName, Number(age));
      if (errs.firstName || errs.age) {
        setFieldErrors(errs);
        setError(errs.firstName || errs.age || "Please check your details.");
        return false;
      }
    }
    return true;
  };

  const saveStepProgress = async (nextStep?: number) => {
    if (savingRef.current || saving) return;
    if (!validateCurrentStep(step)) return;

    const patch = buildPatchForStep(step);
    if (!patch) {
      if (nextStep !== undefined) {
        setStep(nextStep);
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOfflineError(true);
      setError("You appear to be offline. Your answers are preserved here — reconnect and tap Retry.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setOfflineError(false);
    setError("");
    try {
      const updated = await db.updateUser(user.id, patch);
      if (!updated) {
        throw new Error("Could not verify your saved profile update. Please try again.");
      }
      await refresh();
      if (nextStep !== undefined) {
        setStep(nextStep);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save progress. Please retry.";
      setError(msg);
      toast("Couldn't save step progress", "rose");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step < 6) {
      await saveStepProgress(step + 1);
    } else {
      toast(
        currentCompleteness >= 100
          ? "Your Datevra constellation is complete."
          : "Progress saved — you can finish remaining details anytime in Profile.",
        "gold",
      );
      navigate("/discover", { replace: true });
    }
  };

  const handleBack = () => {
    if (step > 1 && !saving) {
      setStep(step - 1);
      setError("");
      setFieldErrors({});
      setOfflineError(false);
    }
  };

  return (
    <div className="min-h-screen bg-midnight text-ivory flex flex-col relative overflow-x-hidden">
      {/* Ambient luxury glows */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-burgundy/30 blur-[140px]" />
      <div className="pointer-events-none absolute top-1/2 -right-40 h-[30rem] w-[30rem] rounded-full bg-rosegold/15 blur-[140px]" />

      {/* Header bar */}
      <header className="relative z-10 border-b hairline glass-strong px-4 sm:px-6 py-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/app" aria-label="Datevra home" className="min-h-[44px] flex items-center">
            <Logo size={30} />
          </Link>
          <div className="hidden sm:block h-5 w-px bg-white/10" />
          <div className="hidden sm:flex items-center gap-2 text-xs text-mist">
            <span>{STEPS[step - 1].kicker}</span>
            <span>·</span>
            <span className="text-champagne font-medium">{STEPS[step - 1].title}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="hidden md:flex flex-col text-right text-xs">
              <span className="text-ivory font-medium">{currentCompleteness}%</span>
              <span className="text-[0.68rem] text-mist">profile strength</span>
            </div>
            <div
              className="w-16 sm:w-24 h-2 rounded-full bg-white/10 overflow-hidden"
              role="progressbar"
              aria-label="Onboarding step progress"
              aria-valuenow={step}
              aria-valuemin={1}
              aria-valuemax={6}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-rosegold via-champagne to-rosegold"
                animate={{ width: `${(step / 6) * 100}%` }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: "easeOut" }}
              />
            </div>
          </div>
          <Link
            to="/app"
            className="text-xs text-mist hover:text-ivory transition-colors px-3 min-h-[44px] flex items-center rounded-full border border-white/10 touch-manipulation whitespace-nowrap"
          >
            Skip to App →
          </Link>
        </div>
      </header>

      {/* Main wizard content */}
      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-8 relative z-10">
        <div className="w-full max-w-2xl">
          <div className="flex sm:hidden items-center justify-between text-xs text-mist mb-3 px-1">
            <span>{STEPS[step - 1].kicker}</span>
            <span className="text-champagne font-medium">{STEPS[step - 1].title} · {currentCompleteness}%</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28 }}
              className="glass-strong rounded-[2rem] p-5 sm:p-10 border hairline relative overflow-hidden"
            >
              {/* Step 1: Basic Identity */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 1</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">First impressions</h1>
                    <p className="text-sm text-mist mt-1">Let&apos;s start with the basics of who you are.</p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <Field label="First name" hint="What should matches call you?">
                      <input
                        className={inputCls}
                        value={firstName}
                        onChange={(e) => {
                          setFirstName(e.target.value);
                          if (fieldErrors.firstName) setFieldErrors((fe) => ({ ...fe, firstName: undefined }));
                        }}
                        placeholder="Aarav"
                        maxLength={40}
                        autoComplete="given-name"
                        aria-invalid={Boolean(fieldErrors.firstName)}
                        aria-describedby={fieldErrors.firstName ? "ob-err-firstName" : undefined}
                      />
                      {fieldErrors.firstName && (
                        <p id="ob-err-firstName" className="mt-1.5 text-xs text-rosegold" role="alert">
                          {fieldErrors.firstName}
                        </p>
                      )}
                    </Field>
                    <Field label="Age" hint="Must be 18 or older">
                      <input
                        type="number"
                        min={18}
                        max={100}
                        className={inputCls}
                        value={age}
                        onChange={(e) => {
                          setAge(Number(e.target.value));
                          if (fieldErrors.age) setFieldErrors((fe) => ({ ...fe, age: undefined }));
                        }}
                        placeholder="25"
                        aria-invalid={Boolean(fieldErrors.age)}
                        aria-describedby={fieldErrors.age ? "ob-err-age" : undefined}
                      />
                      {fieldErrors.age && (
                        <p id="ob-err-age" className="mt-1.5 text-xs text-rosegold" role="alert">
                          {fieldErrors.age}
                        </p>
                      )}
                    </Field>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <Field label="I identify as">
                      <select
                        className={inputCls}
                        value={gender}
                        onChange={(e) => setGender(e.target.value as Gender)}
                      >
                        {GENDERS.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="City">
                      <select
                        className={inputCls}
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      >
                        {CITIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              {/* Step 2: About You (Bio only — public.profiles has no headline column) */}
              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 2</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">Write your introduction</h1>
                    <p className="text-sm text-mist mt-1">
                      Optional — share what makes you tick, what you enjoy, and what a memorable evening looks like.
                    </p>
                  </div>

                  <Field label="Bio" hint={`${500 - bio.length} characters left`}>
                    <textarea
                      rows={5}
                      className={`${inputCls} resize-none`}
                      value={bio}
                      maxLength={500}
                      onChange={(e) => setBio(e.target.value.slice(0, 500))}
                      placeholder="e.g. Architect by day, vinyl enthusiast by night. I appreciate quiet coffee corners, art galleries, and authentic conversation..."
                    />
                  </Field>
                </div>
              )}

              {/* Step 3: Dating Intention */}
              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 3</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">Your intentions</h1>
                    <p className="text-sm text-mist mt-1">
                      Clarity creates better chemistry. What kind of connection are you seeking?
                    </p>
                  </div>

                  <Field label="I am interested in meeting">
                    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                      {INTERESTED_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setInterestedIn(opt.id)}
                          aria-pressed={interestedIn === opt.id}
                          className={`min-h-[44px] py-3 px-2 sm:px-4 rounded-xl border text-xs sm:text-sm font-medium transition-all ${
                            interestedIn === opt.id
                              ? "border-champagne bg-champagne/15 text-champagne shadow-sm"
                              : "border-white/10 bg-white/5 text-ivory hover:border-white/20"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Relationship intent (optional)">
                    <div className="space-y-2">
                      {RELATIONSHIP_INTENTS.map((intent) => {
                        const selected = relationshipIntent === intent;
                        return (
                          <button
                            key={intent}
                            type="button"
                            onClick={() => setRelationshipIntent(selected ? "" : intent)}
                            aria-pressed={selected}
                            className={`w-full text-left min-h-[44px] py-3 px-4 rounded-xl border text-sm transition-all flex items-center justify-between ${
                              selected
                                ? "border-champagne bg-champagne/15 text-champagne"
                                : "border-white/10 bg-white/5 text-ivory hover:border-white/20"
                            }`}
                          >
                            <span>{intent}</span>
                            {selected && <span aria-hidden>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              )}

              {/* Step 4: Interests, Hobbies & Lifestyle */}
              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 4</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">Passions & lifestyle</h1>
                    <p className="text-sm text-mist mt-1">
                      Optional — select interests to power your compatibility score with other members.
                    </p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wider text-champagne mb-2.5">
                      Interests ({interests.length})
                    </p>
                    <div className="flex flex-wrap gap-2 min-h-[44px] p-3 rounded-xl bg-white/5 border hairline mb-3">
                      {interests.length === 0 ? (
                        <span className="text-xs text-mist">No interests selected yet. Pick tags below or add your own.</span>
                      ) : (
                        interests.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setInterests((prev) => toggleTag(prev, tag))}
                            className="rounded-full bg-champagne/15 border border-champagne/40 text-champagne text-xs px-3 py-1.5 min-h-[36px] flex items-center gap-1.5"
                          >
                            <span>{tag}</span>
                            <span aria-hidden className="text-[0.75rem]">×</span>
                          </button>
                        ))
                      )}
                    </div>

                    <input
                      className={`${inputCls} mb-2.5`}
                      placeholder="Search preset interests…"
                      aria-label="Search preset interests"
                      value={interestQuery}
                      onChange={(e) => setInterestQuery(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                      {presetSuggestions.map((tag) => {
                        const active = interests.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setInterests((prev) => toggleTag(prev, tag))}
                            aria-pressed={active}
                            className={`rounded-full px-3 py-1.5 text-xs border transition-colors ${
                              active
                                ? "bg-rosegold/20 border-rosegold text-rosegold"
                                : "bg-white/5 border-white/10 text-ivory-dim hover:text-ivory hover:border-white/25"
                            }`}
                          >
                            {active ? "✓ " : "+ "}{tag}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <input
                        className={`${inputCls} min-w-0 flex-1`}
                        placeholder="Add custom interest (e.g. Scuba diving)…"
                        aria-label="Custom interest"
                        value={customTag}
                        onChange={(e) => setCustomTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setInterests((prev) => addCustomTagItem(prev, customTag));
                            setCustomTag("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setInterests((prev) => addCustomTagItem(prev, customTag));
                          setCustomTag("");
                        }}
                        className="btn-ghost rounded-xl px-4 min-h-[44px] text-xs shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="hairline" />

                  <Field label="Hobbies (optional)" hint="Things you enjoy in your free time.">
                    {hobbies.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2.5">
                        {hobbies.map((h) => (
                          <button
                            key={h}
                            type="button"
                            onClick={() => setHobbies((prev) => toggleTag(prev, h))}
                            className="rounded-full bg-rosegold/15 border border-rosegold/40 text-rosegold text-xs px-3 py-1.5 flex items-center gap-1.5"
                          >
                            <span>{h}</span>
                            <span aria-hidden>×</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        className={`${inputCls} min-w-0 flex-1`}
                        placeholder="e.g. Weekend cycling, film photography…"
                        value={hobbyInput}
                        onChange={(e) => setHobbyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setHobbies((prev) => addCustomTagItem(prev, hobbyInput));
                            setHobbyInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setHobbies((prev) => addCustomTagItem(prev, hobbyInput));
                          setHobbyInput("");
                        }}
                        className="btn-ghost rounded-xl px-4 min-h-[44px] text-xs shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </Field>

                  <Field label="Lifestyle notes (optional)" hint="e.g. Early riser, Vegetarian, Non-smoker.">
                    {lifestyle.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2.5">
                        {lifestyle.map((l) => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setLifestyle((prev) => toggleTag(prev, l))}
                            className="rounded-full bg-white/5 border border-white/20 text-ivory-dim text-xs px-3 py-1.5 flex items-center gap-1.5"
                          >
                            <span>{l}</span>
                            <span aria-hidden>×</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        className={`${inputCls} min-w-0 flex-1`}
                        placeholder="Add a lifestyle note…"
                        value={lifestyleInput}
                        onChange={(e) => setLifestyleInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setLifestyle((prev) => addCustomTagItem(prev, lifestyleInput));
                            setLifestyleInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setLifestyle((prev) => addCustomTagItem(prev, lifestyleInput));
                          setLifestyleInput("");
                        }}
                        className="btn-ghost rounded-xl px-4 min-h-[44px] text-xs shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </Field>
                </div>
              )}

              {/* Step 5: Photos */}
              {step === 5 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 5</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">Your photo gallery</h1>
                    <p className="text-sm text-mist mt-1">
                      Add clear, warm photos of yourself. Your first photo becomes your discovery card image.
                    </p>
                  </div>

                  <PhotoManager />
                </div>
              )}

              {/* Step 6: Summary & Review */}
              {step === 6 && (
                <div className="space-y-6">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.28em] text-rosegold">Step 6</p>
                    <h1 className="font-display text-3xl text-ivory mt-1">Review your constellation</h1>
                    <p className="text-sm text-mist mt-1">
                      Here is how your profile appears to eligible members in Discovery ({currentCompleteness}% complete).
                    </p>
                  </div>

                  {/* Discovery Preview Card */}
                  <div className="glass glow-border rounded-2xl overflow-hidden border hairline max-w-sm mx-auto">
                    <div className="relative h-64 bg-coal">
                      {user.photos && user.photos[0] ? (
                        <img
                          src={user.photos[0]}
                          alt={`${firstName || user.firstName}'s primary photo`}
                          className="h-full w-full object-cover"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-coal via-burgundy-deep to-midnight">
                          <Avatar name={firstName || "You"} size={80} ring />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-midnight via-transparent to-transparent" />
                      <div className="absolute bottom-3 left-4 right-4">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-display text-2xl text-ivory">{firstName || user.firstName}, {age}</span>
                          {user.verified && <Badge tone="green">Verified</Badge>}
                        </div>
                        <p className="text-xs text-rosegold">{city}</p>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      {relationshipIntent && (
                        <p className="text-xs text-champagne italic">“{relationshipIntent}”</p>
                      )}
                      {bio && (
                        <p className="text-xs text-ivory-dim leading-relaxed line-clamp-2">{bio}</p>
                      )}
                      {interests.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {interests.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-champagne/10 border border-champagne/30 text-champagne px-2 py-0.5 text-[0.68rem]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-center pt-2">
                    <p className="text-xs text-mist">
                      Want to refine anything? Jump directly to any step below.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-3">
                      {STEPS.slice(0, 5).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStep(s.id)}
                          className="text-xs text-champagne/90 hover:text-champagne px-3.5 min-h-[38px] rounded-full border border-champagne/25"
                        >
                          Edit {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Error & retry banner */}
              {error && (
                <div
                  role="alert"
                  className="mt-5 p-3.5 rounded-xl bg-burgundy/30 border border-rosegold/30 text-xs text-rosegold flex items-center justify-between gap-3 flex-wrap"
                >
                  <span>{error}</span>
                  {(offlineError || step <= 4) && (
                    <button
                      type="button"
                      onClick={() => void saveStepProgress(step < 6 ? step + 1 : undefined)}
                      disabled={saving}
                      className="btn-ghost rounded-full px-3.5 py-1.5 text-xs text-ivory shrink-0"
                    >
                      Retry save
                    </button>
                  )}
                </div>
              )}

              {/* Navigation controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-8 pt-6 border-t hairline">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={step === 1 || saving}
                  className="btn-ghost rounded-full px-5 min-h-[44px] text-xs disabled:opacity-40"
                >
                  ← Back
                </button>

                <button
                  type="button"
                  onClick={() => void handleNext()}
                  disabled={saving}
                  className="btn-gold rounded-full px-6 sm:px-7 min-h-[44px] text-xs font-semibold disabled:opacity-60 flex items-center gap-2"
                >
                  {saving
                    ? "Saving…"
                    : step === 6
                      ? currentCompleteness >= 100
                        ? "Complete & Enter Datevra ✨"
                        : "Enter Discovery →"
                      : "Continue →"}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
