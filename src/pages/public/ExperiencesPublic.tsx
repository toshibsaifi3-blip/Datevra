import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Badge,
  Field,
  Modal,
  PageHero,
  Reveal,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import type { Cafe } from "../../lib/types";
import { CafePhotoSlider } from "../../components/CafePhotoSlider";

interface CafeExperienceConfig {
  cafeId: string;
  displayName: string;
  minBudget: number;
  maxBudget: number;
  experiences: {
    id: string;
    title: string;
  }[];
}

const EXPERIENCES_CONFIG: CafeExperienceConfig[] = [
  {
    cafeId: "c-hot-stag-del",
    displayName: "Café Hot Stag",
    minBudget: 3200,
    maxBudget: 13000,
    experiences: [
      { id: "e-hotstag-premium-date", title: "Premium Date" },
      { id: "e-hotstag-coffee-date", title: "Premium Coffee Date" },
      { id: "e-hotstag-italian", title: "Italian Cuisine Date with Premium Experience" },
    ],
  },
  {
    cafeId: "c-karmala-del",
    displayName: "Karma La Cafe",
    minBudget: 4500,
    maxBudget: 25000,
    experiences: [
      { id: "e-karmala-karaoke", title: "Premium Date with Live Karaoke" },
    ],
  },
];

const PREFERRED_TIME_SLOTS = [
  "12:00 PM",
  "1:30 PM",
  "3:00 PM",
  "4:30 PM",
  "6:00 PM",
  "7:30 PM",
  "8:30 PM",
  "9:30 PM",
];

export default function ExperiencesPublic({ hideHero = false }: { hideHero?: boolean }) {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const db = useBackend();

  // Load cafes
  const { data: allCafes, loading: loadingCafes, error: cafesError } = useAsync(
    (b) => b.listCafes(),
    [db],
    [] as Cafe[],
  );

  // Application booking form state
  const [activeCafeConfig, setActiveCafeConfig] = useState<CafeExperienceConfig | null>(null);
  const [selectedCafe, setSelectedCafe] = useState<Cafe | null>(null);
  const [selectedExperience, setSelectedExperience] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [preferredTime, setPreferredTime] = useState<string>("7:30 PM");
  const [guestCount, setGuestCount] = useState<number>(2);
  const [formBudgetRange, setFormBudgetRange] = useState<[number, number]>([3200, 13000]);
  const [note, setNote] = useState<string>("");
  const [isReviewStep, setIsReviewStep] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [submittedApp, setSubmittedApp] = useState<{
    cafeName: string;
    expTitle: string;
    date: string;
    time: string;
    guests: number;
    budgetRange: [number, number];
  } | null>(null);

  // Today's date string YYYY-MM-DD for date-picker min
  const todayStr = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  // Display ONLY the two specified cafés: Café Hot Stag and Karma La Cafe
  const displayedCafes = useMemo(() => {
    return EXPERIENCES_CONFIG.map((cfg) => {
      const cafeRecord = allCafes.find((c) => c.id === cfg.cafeId);
      return {
        cfg,
        cafe: cafeRecord || {
          id: cfg.cafeId,
          name: cfg.displayName,
          city: "Delhi",
          address:
            cfg.cafeId === "c-hot-stag-del"
              ? "1st Floor, Opp. Deer Park, Ayyappa Temple Road, Dilshad Garden, Delhi-110095"
              : "Tsampa House, 5th Floor, Plot Nos. 18 & 19, Gate No. 3, Majnu Ka Tilla, New Aruna Nagar Colony, Delhi-110054",
          description: "",
          image: cfg.cafeId === "c-hot-stag-del" ? "/assets/cafes/hot-stag-1.jpg" : "/assets/cafes/karmala-1.jpg",
          images:
            cfg.cafeId === "c-hot-stag-del"
              ? [
                  "/assets/cafes/hot-stag-1.jpg",
                  "/assets/cafes/hot-stag-2.jpg",
                  "/assets/cafes/hot-stag-3.jpg",
                  "/assets/cafes/hot-stag-4.jpg",
                ]
              : [
                  "/assets/cafes/karmala-1.jpg",
                  "/assets/cafes/karmala-2.jpg",
                  "/assets/cafes/karmala-3.jpg",
                  "/assets/cafes/karmala-4.jpg",
                ],
          priceRange: "₹₹" as const,
          openingHours: "",
          experiences: cfg.experiences.map((e) => e.title),
          bookingInfo: "",
          rating: 0,
          partner: false,
          commissionPct: 0,
          agreementRef: null,
          totalBookings: 0,
          revenue: 0,
          menu: "",
        },
      };
    });
  }, [allCafes]);

  // Open Application Form with cafe-specific budget initialization
  const openApplication = (cfg: CafeExperienceConfig, cafe: Cafe) => {
    if (!session || !user) {
      navigate("/login");
      return;
    }
    setActiveCafeConfig(cfg);
    setSelectedCafe(cafe);
    setSelectedExperience(cfg.experiences[0]?.id ?? "");
    setSelectedDate("");
    setPreferredTime("7:30 PM");
    setGuestCount(2);
    // Initialize dedicated café-specific budget slider limits
    setFormBudgetRange([cfg.minBudget, cfg.maxBudget]);
    setNote("");
    setIsReviewStep(false);
    setSubmittedApp(null);
  };

  const closeApplication = () => {
    setActiveCafeConfig(null);
    setSelectedCafe(null);
    setIsReviewStep(false);
  };

  // Submit Application
  const submitApplication = async () => {
    if (!user || !activeCafeConfig || !selectedCafe) return;
    if (!selectedDate) {
      toast("Please choose a reservation date", "rose");
      return;
    }
    if (selectedDate < todayStr) {
      toast("Past dates cannot be selected", "rose");
      return;
    }

    const expObj = activeCafeConfig.experiences.find((e) => e.id === selectedExperience);
    const expTitle = expObj?.title || "Curated Date Experience";

    setBusy(true);
    try {
      // Build structured note combining venue, experience, guests, budget range, and user note
      const structuredNoteParts = [
        `[Venue: ${activeCafeConfig.displayName}]`,
        `[Experience: ${expTitle}]`,
        `[Guests: ${guestCount}]`,
        `[Budget: ₹${formBudgetRange[0].toLocaleString("en-IN")} – ₹${formBudgetRange[1].toLocaleString("en-IN")}]`,
        note.trim() ? `Note: ${note.trim()}` : "",
      ].filter(Boolean);

      const finalNote = structuredNoteParts.join(" · ").slice(0, 500);

      await db.applyForExperience({
        userId: user.id,
        experienceId: selectedExperience,
        slotDate: selectedDate,
        slotTime: preferredTime,
        note: finalNote,
      });

      setSubmittedApp({
        cafeName: activeCafeConfig.displayName,
        expTitle,
        date: selectedDate,
        time: preferredTime,
        guests: guestCount,
        budgetRange: formBudgetRange,
      });
      setIsReviewStep(false);
      toast("Application submitted successfully — pending review by our team.", "gold");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const msgLower = msg.toLowerCase();
      if (msgLower.includes("foreign key") || msgLower.includes("date_applications_experience_id_fkey")) {
        toast("This curated experience is not yet available for applications in the live catalogue. Your details have been kept — please try again later or contact concierge.", "rose");
      } else if (msg.includes("requires an active Elite") || msg.includes("requires an active Privé")) {
        toast("This curated experience is reserved for Privé members.", "rose");
      } else {
        toast(msg || "Could not submit your application. Please check your reservation details and try again.", "rose");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative overflow-x-clip">
      {/* Dreamy ambience background sparkles */}
      <div className="pointer-events-none absolute top-0 right-1/4 h-96 w-96 rounded-full bg-rosegold/10 blur-[130px] animate-aura-shift" />
      {[8, 30, 52, 76, 92].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-champagne/25 animate-twinkle"
          style={{
            left: `${left}%`,
            top: `${70 + i * 170}px`,
            animationDelay: `${i * 0.7}s`,
            fontSize: `${9 + (i % 3) * 4}px`,
          }}
        >
          ✦
        </span>
      ))}

      {!hideHero && (
        <PageHero
          kicker="Curated experiences"
          title="Dates, arranged like art"
          sub="Explore partner cafés and apply for exclusive dates arranged with care."
        />
      )}

      <section className="relative max-w-6xl mx-auto px-4 sm:px-5 py-8 sm:py-10 md:py-14">
        {/* ============================================================== */}
        {/* CAFÉ EXPERIENCE CARDS (Café Hot Stag & Karma La Cafe only)      */}
        {/* ============================================================== */}
        {loadingCafes ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[34rem] rounded-[2rem]" />
            ))}
          </div>
        ) : cafesError ? (
          <p className="text-center text-rosegold">{cafesError}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {displayedCafes.map(({ cfg, cafe }, i) => (
              <Reveal key={cfg.cafeId} delay={i * 0.1} className="h-full">
                <motion.article
                  whileHover={{ y: -8 }}
                  transition={{ type: "spring", stiffness: 240, damping: 22 }}
                  className="glass rounded-[2rem] overflow-hidden h-full flex flex-col card-hover relative border border-white/10"
                >
                  {/* Photo Slider */}
                  <div className="relative">
                    <CafePhotoSlider
                      images={cafe.images && cafe.images.length > 0 ? cafe.images : [cafe.image]}
                      cafeName={cfg.displayName}
                      aspectRatioClassName="h-64 sm:h-72"
                      fallbackLetter={cfg.displayName.charAt(0)}
                    />
                    <div className="absolute top-4 left-4 z-20 pointer-events-none">
                      <Badge tone="gold">✦ Curated Venue</Badge>
                    </div>
                    <div className="absolute top-4 right-4 z-20 pointer-events-none">
                      <Badge tone="muted">Delhi</Badge>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 sm:p-7 flex-1 flex flex-col">
                    <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
                      <h3 className="font-display text-2xl md:text-3xl text-ivory">
                        {cfg.displayName}
                      </h3>
                      <div className="sm:text-right shrink-0">
                        <span className="text-[0.65rem] uppercase tracking-widest text-mist block">
                          Indicative budget
                        </span>
                        <span className="text-sm font-semibold text-champagne whitespace-nowrap">
                          ₹{cfg.minBudget.toLocaleString("en-IN")} – ₹{cfg.maxBudget.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>

                    {/* Full Address */}
                    <p className="text-xs text-champagne/90 mt-2 leading-relaxed break-words font-medium">
                      {cafe.address}
                    </p>

                    {/* Available Experiences for this Cafe */}
                    <div className="mt-6 flex-1">
                      <p className="text-[0.68rem] uppercase tracking-[0.25em] text-rosegold mb-2.5 font-semibold">
                        Available Experiences ({cfg.experiences.length})
                      </p>
                      <div className="space-y-2">
                        {cfg.experiences.map((exp) => (
                          <div
                            key={exp.id}
                            className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/15 transition-colors"
                          >
                            <span className="text-rosegold text-sm shrink-0">✦</span>
                            <span className="text-sm text-ivory font-medium min-w-0 break-words">{exp.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="mt-7 pt-5 border-t border-white/10 flex flex-col sm:flex-row items-center gap-3">
                      <button
                        onClick={() => openApplication(cfg, cafe)}
                        className="btn-gold rounded-full px-7 py-3 min-h-[44px] inline-flex items-center justify-center text-sm font-semibold w-full sm:flex-1 touch-manipulation"
                      >
                        Apply for Experience
                      </button>
                      <Link
                        to={`/cafes/${cfg.cafeId}`}
                        className="btn-ghost rounded-full px-5 py-3 min-h-[44px] inline-flex items-center justify-center text-xs text-mist hover:text-ivory w-full sm:w-auto text-center touch-manipulation"
                      >
                        View café details
                      </Link>
                    </div>
                    <p className="text-[0.7rem] text-mist/70 text-center mt-2.5">
                      Applying is free · selection is manual and subject to admin review
                    </p>
                  </div>
                </motion.article>
              </Reveal>
            ))}
          </div>
        )}

        {/* Informational reassurance section */}
        <Reveal className="mt-16">
          <div className="glass-strong glow-border rounded-[2rem] p-6 sm:p-8 text-center max-w-3xl mx-auto relative overflow-hidden">
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-72 rounded-full bg-rosegold/15 blur-[80px]" />
            <p className="text-[0.7rem] uppercase tracking-[0.3em] text-rosegold relative">Honest by design</p>
            <h3 className="font-display text-2xl text-ivory mt-2 relative">How experience applications work</h3>
            <p className="mt-3 text-sm text-ivory-dim/85 leading-relaxed relative">
              Submit your preferred date and timing for either venue along with your comfortable budget range. Our team reviews every application manually to ensure seamless coordination with the partner café. Applications remain pending until confirmed by an authorized administrator.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ============================================================== */}
      {/* APPLICATION BOOKING FORM MODAL                                 */}
      {/* ============================================================== */}
      <Modal
        open={Boolean(activeCafeConfig && selectedCafe)}
        onClose={closeApplication}
        title={
          submittedApp
            ? "Application Submitted"
            : isReviewStep
            ? "Review Your Application"
            : `Apply for Experience · ${activeCafeConfig?.displayName || ""}`
        }
        wide
      >
        {submittedApp ? (
          <div className="space-y-6 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500/20 to-champagne/20 border border-emerald-400/40 flex items-center justify-center text-3xl mx-auto">
              ✓
            </div>
            <div>
              <h4 className="font-display text-2xl text-ivory">Application Received</h4>
              <p className="text-sm text-mist mt-2 max-w-md mx-auto leading-relaxed">
                Your application for <strong className="text-champagne">{submittedApp.expTitle}</strong> at{" "}
                <strong className="text-ivory">{submittedApp.cafeName}</strong> has been saved.
              </p>
            </div>

            <div className="glass rounded-2xl p-4 text-left max-w-md mx-auto space-y-2.5 text-sm border border-white/10">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Reservation Date:</span>
                <span className="text-ivory font-medium">{submittedApp.date}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Preferred Timing:</span>
                <span className="text-ivory font-medium">{submittedApp.time} (Subject to confirmation)</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Party Size:</span>
                <span className="text-ivory font-medium">{submittedApp.guests} guests</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Budget Preference:</span>
                <span className="text-champagne font-medium">
                  ₹{submittedApp.budgetRange[0].toLocaleString("en-IN")} – ₹{submittedApp.budgetRange[1].toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex flex-wrap justify-between items-center gap-2 pt-1.5 border-t border-white/5">
                <span className="text-mist">Status:</span>
                <Badge tone="gold">Pending Admin Review</Badge>
              </div>
            </div>

            <p className="text-xs text-mist/80 max-w-md mx-auto">
              Please note: Selecting a preferred time is subject to café confirmation. A reservation is never confirmed merely by submitting an application. You can track this in{" "}
              <Link to="/experiences" onClick={closeApplication} className="text-rosegold underline">
                My applications
              </Link>
              .
            </p>

            <button
              onClick={closeApplication}
              className="btn-gold rounded-full px-8 py-3 text-sm font-semibold w-full max-w-xs mx-auto"
            >
              Done
            </button>
          </div>
        ) : isReviewStep ? (
          /* Step 2: Application Summary Review */
          <div className="space-y-6">
            <p className="text-sm text-ivory-dim/90">
              Please review your application details before submitting to our curation team.
            </p>

            <div className="glass rounded-2xl p-4 sm:p-5 space-y-3.5 border border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Selected Café</span>
                <span className="text-sm text-ivory font-semibold text-right min-w-0 break-words">
                  {activeCafeConfig?.displayName}
                </span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Experience</span>
                <span className="text-sm text-champagne font-semibold text-right min-w-0 break-words">
                  {activeCafeConfig?.experiences.find((e) => e.id === selectedExperience)?.title}
                </span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Reservation Date</span>
                <span className="text-sm text-ivory font-medium text-right min-w-0 break-words">{selectedDate}</span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Preferred Timing</span>
                <span className="text-sm text-ivory font-medium text-right min-w-0 break-words">
                  {preferredTime}{" "}
                  <span className="text-xs text-mist block font-normal">(Subject to confirmation)</span>
                </span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Guest Count</span>
                <span className="text-sm text-ivory font-medium text-right min-w-0 break-words">{guestCount} Guests</span>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <span className="text-xs uppercase tracking-wider text-mist shrink-0">Comfortable Budget</span>
                <span className="text-sm text-champagne font-semibold text-right min-w-0 break-words">
                  ₹{formBudgetRange[0].toLocaleString("en-IN")} – ₹{formBudgetRange[1].toLocaleString("en-IN")}
                </span>
              </div>
              {note.trim() && (
                <div className="pt-2 border-t border-white/10">
                  <span className="text-xs uppercase tracking-wider text-mist block mb-1">
                    Special Note
                  </span>
                  <p className="text-xs text-ivory-dim italic bg-black/20 p-2.5 rounded-lg break-words [overflow-wrap:anywhere]">
                    “{note.trim()}”
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsReviewStep(false)}
                className="btn-ghost rounded-full px-6 py-3 min-h-[44px] text-sm flex-1 min-w-[140px] touch-manipulation"
              >
                ← Edit details
              </button>
              <button
                type="button"
                onClick={submitApplication}
                disabled={busy}
                className="btn-gold rounded-full px-6 py-3 min-h-[44px] text-sm font-semibold flex-1 min-w-[160px] disabled:opacity-60 touch-manipulation"
              >
                {busy ? "Submitting…" : "Confirm & Submit Application"}
              </button>
            </div>
          </div>
        ) : (
          /* Step 1: Application Form Input */
          <div className="space-y-5">
            {/* Field A: Selected Café (Read-only banner) */}
            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[0.68rem] uppercase tracking-wider text-mist block">
                  Selected Venue
                </span>
                <span className="font-display text-xl text-ivory font-semibold">
                  {activeCafeConfig?.displayName}
                </span>
                <span className="text-xs text-mist block line-clamp-1 mt-0.5">
                  {selectedCafe?.address}
                </span>
              </div>
              <Badge tone="gold">Verified Partner</Badge>
            </div>

            {/* Field B: Selected Experience (Radio options strictly for this cafe) */}
            <Field label="Choose Experience Package">
              <div className="space-y-2 mt-1">
                {activeCafeConfig?.experiences.map((exp) => (
                  <label
                    key={exp.id}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all cursor-pointer touch-manipulation ${
                      selectedExperience === exp.id
                        ? "border-rosegold bg-rosegold/10 text-ivory shadow-[0_0_15px_rgba(255,61,154,0.15)]"
                        : "border-white/10 bg-white/[0.02] text-ivory-dim hover:border-white/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="selectedExperience"
                      value={exp.id}
                      checked={selectedExperience === exp.id}
                      onChange={() => setSelectedExperience(exp.id)}
                      className="accent-rosegold h-4 w-4"
                    />
                    <span className="text-sm font-medium">{exp.title}</span>
                  </label>
                ))}
              </div>
            </Field>

            {/* Field C: Dedicated Café-Specific Budget Slider */}
            {activeCafeConfig && (
              <Field
                label={`Preferred Budget Range (${activeCafeConfig.displayName})`}
                hint={`Indicative range: ₹${activeCafeConfig.minBudget.toLocaleString("en-IN")} – ₹${activeCafeConfig.maxBudget.toLocaleString("en-IN")}`}
              >
                <div className="glass rounded-2xl p-4 border border-white/10 mt-1">
                  <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/[0.03] border border-white/5 mb-4">
                    <div>
                      <span className="text-[0.62rem] uppercase tracking-wider text-mist block">Min budget</span>
                      <span className="font-display text-lg text-champagne font-semibold">
                        ₹{formBudgetRange[0].toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="text-mist text-sm font-light px-2">to</div>
                    <div className="text-right">
                      <span className="text-[0.62rem] uppercase tracking-wider text-mist block">Max budget</span>
                      <span className="font-display text-lg text-rosegold font-semibold">
                        ₹{formBudgetRange[1].toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>

                  {/* Dual-Handle Slider Controls */}
                  <div className="relative pt-4 pb-2 px-1">
                    <div className="relative h-2 rounded-full bg-white/10">
                      <div
                        className="absolute h-full rounded-full bg-gradient-to-r from-champagne via-rosegold to-burgundy-soft"
                        style={{
                          left: `${
                            ((formBudgetRange[0] - activeCafeConfig.minBudget) /
                              (activeCafeConfig.maxBudget - activeCafeConfig.minBudget)) *
                            100
                          }%`,
                          right: `${
                            100 -
                            ((formBudgetRange[1] - activeCafeConfig.minBudget) /
                              (activeCafeConfig.maxBudget - activeCafeConfig.minBudget)) *
                              100
                          }%`,
                        }}
                      />
                    </div>

                    {/* Lower Handle */}
                    <input
                      type="range"
                      min={activeCafeConfig.minBudget}
                      max={activeCafeConfig.maxBudget}
                      step={activeCafeConfig.cafeId === "c-hot-stag-del" ? 100 : 500}
                      value={formBudgetRange[0]}
                      aria-label="Minimum comfortable budget in INR"
                      onChange={(e) => {
                        const step = activeCafeConfig.cafeId === "c-hot-stag-del" ? 100 : 500;
                        const val = Number(e.target.value);
                        setFormBudgetRange(([_, upper]) => [Math.min(val, upper - step), upper]);
                      }}
                      className="absolute inset-x-1 top-2.5 w-[calc(100%-0.5rem)] pointer-events-none appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-champagne [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(240,220,174,0.8)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:touch-manipulation [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-champagne [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
                    />

                    {/* Upper Handle */}
                    <input
                      type="range"
                      min={activeCafeConfig.minBudget}
                      max={activeCafeConfig.maxBudget}
                      step={activeCafeConfig.cafeId === "c-hot-stag-del" ? 100 : 500}
                      value={formBudgetRange[1]}
                      aria-label="Maximum comfortable budget in INR"
                      onChange={(e) => {
                        const step = activeCafeConfig.cafeId === "c-hot-stag-del" ? 100 : 500;
                        const val = Number(e.target.value);
                        setFormBudgetRange(([lower, _]) => [lower, Math.max(val, lower + step)]);
                      }}
                      className="absolute inset-x-1 top-2.5 w-[calc(100%-0.5rem)] pointer-events-none appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-rosegold [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,61,154,0.8)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:touch-manipulation [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-rosegold [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
                    />
                  </div>

                  <div className="flex justify-between text-[0.65rem] text-mist/70 px-1 mt-1">
                    <span>₹{activeCafeConfig.minBudget.toLocaleString("en-IN")}</span>
                    <span>₹{activeCafeConfig.maxBudget.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </Field>
            )}

            {/* Field D: Date Selection (Interactive calendar picker, past disabled) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Preferred Reservation Date"
                hint="Past dates disabled. Subject to venue review."
              >
                <input
                  type="date"
                  min={todayStr}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className={`${inputCls} appearance-none min-w-0 accent-rosegold cursor-pointer`}
                  required
                />
              </Field>

              {/* Field E: Preferred Timing */}
              <Field
                label="Preferred Reservation Time"
                hint="Preferred time (subject to café confirmation)."
              >
                <select
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  className={inputCls}
                >
                  {PREFERRED_TIME_SLOTS.map((t) => (
                    <option key={t} value={t} className="bg-onyx text-ivory">
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Field F: Guest Count */}
            <Field label="Guest Count" hint="Table seating party size">
              <select
                value={guestCount}
                onChange={(e) => setGuestCount(Number(e.target.value))}
                className={inputCls}
              >
                <option value={2} className="bg-onyx text-ivory">2 Guests (Couple / Date)</option>
                <option value={3} className="bg-onyx text-ivory">3 Guests</option>
                <option value={4} className="bg-onyx text-ivory">4 Guests (Double Date)</option>
              </select>
            </Field>

            {/* Field G: Additional Note */}
            <Field
              label="Additional Note / Special Requests"
              hint="Optional — dietary preferences, seating requests, or special occasions."
            >
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Celebrating an anniversary; prefer a quiet corner table if available…"
                className={`${inputCls} min-h-[80px] resize-y`}
                maxLength={400}
              />
            </Field>

            {/* Form Actions */}
            <div className="flex flex-wrap gap-3 pt-3">
              <button
                type="button"
                onClick={closeApplication}
                className="btn-ghost rounded-full px-6 py-3 min-h-[44px] text-sm flex-1 min-w-[120px] touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedDate) {
                    toast("Please select a date for your experience", "rose");
                    return;
                  }
                  if (selectedDate < todayStr) {
                    toast("Past dates cannot be selected", "rose");
                    return;
                  }
                  setIsReviewStep(true);
                }}
                className="btn-gold rounded-full px-6 py-3 min-h-[44px] text-sm font-semibold flex-1 min-w-[160px] touch-manipulation"
              >
                Review Application →
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
