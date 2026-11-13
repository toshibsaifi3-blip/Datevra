import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { ApplicationStatus, Cafe, DateApplication, DateExperience, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { MigrationAlertBanner } from "../../components/MigrationAlertBanner";
import { fmtDate, inr, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<ApplicationStatus, "gold" | "rose" | "green" | "muted"> = {
  submitted: "gold",
  under_review: "gold",
  eligible: "gold",
  selected: "rose",
  confirmed: "green",
  completed: "green",
  declined: "muted",
  cancelled: "muted",
};

const NEXT: Partial<Record<ApplicationStatus, ApplicationStatus[]>> = {
  submitted: ["under_review", "declined"],
  under_review: ["eligible", "declined"],
  eligible: ["selected", "declined"],
  selected: ["confirmed", "declined", "cancelled"],
  confirmed: ["completed", "cancelled"],
};

/**
 * Helper to parse structured metadata encoded in the application note:
 * e.g., "[Venue: Café Hot Stag] · [Experience: Premium Date] · [Guests: 2] · [Budget: ₹3,200 – ₹13,000] · Note: Celebrating birthday"
 */
function parseApplicationNote(rawNote: string | null | undefined) {
  if (!rawNote) {
    return {
      venue: "",
      experienceTitle: "",
      guestCount: "",
      budgetRange: "",
      userNote: "",
    };
  }

  const venueMatch = rawNote.match(/\[Venue:\s*([^\]]+)\]/);
  const expMatch = rawNote.match(/\[Experience:\s*([^\]]+)\]/);
  const guestsMatch = rawNote.match(/\[Guests:\s*([^\]]+)\]/);
  const budgetMatch = rawNote.match(/\[Budget:\s*([^\]]+)\]/);
  const noteMatch = rawNote.match(/Note:\s*(.+)$/);

  // If user note did not start with "Note: " but had other free text
  let userNote = noteMatch ? noteMatch[1].trim() : "";
  if (!userNote && !rawNote.startsWith("[")) {
    userNote = rawNote.trim();
  }

  return {
    venue: venueMatch ? venueMatch[1].trim() : "",
    experienceTitle: expMatch ? expMatch[1].trim() : "",
    guestCount: guestsMatch ? guestsMatch[1].trim() : "",
    budgetRange: budgetMatch ? budgetMatch[1].trim() : "",
    userNote,
  };
}

export default function Applications() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();

  // Search and Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cafeFilter, setCafeFilter] = useState("all");
  const [expFilter, setExpFilter] = useState("all");

  // Detailed View Modal
  const [viewDetailApp, setViewDetailApp] = useState<DateApplication | null>(null);

  // Decision & Confirmation Modal
  const [decideFor, setDecideFor] = useState<{ app: DateApplication; next: ApplicationStatus } | null>(null);
  const [adminNote, setAdminNote] = useState("");

  // Booking Modal
  const [bookingFor, setBookingFor] = useState<DateApplication | null>(null);
  const [partnerId, setPartnerId] = useState("");
  const [cafeId, setCafeId] = useState("");
  const [venue, setVenue] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [amount, setAmount] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: appsRaw, loading, error, refresh: refreshApps } = useAsync(
    (b) => b.allApplications(),
    [db],
    [] as DateApplication[],
  );
  const { data: all, refresh: refreshUsers } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);
  const { data: exps } = useAsync((b) => b.listExperiences(), [db], [] as DateExperience[]);

  useEffect(() => {
    const off1 = db.subscribe("applications", refreshApps);
    const off2 = db.subscribe("bookings", refreshApps);
    const off3 = db.subscribe("profiles", refreshUsers);
    return () => {
      off1();
      off2();
      off3();
    };
  }, [db, refreshApps, refreshUsers]);

  const userMap = useMemo(() => new Map(all.map((u) => [u.id, u])), [all]);
  const expMap = useMemo(() => new Map(exps.map((e) => [e.id, e])), [exps]);

  // Filtered Applications with search, status, cafe, and experience filters
  const filteredApps = useMemo(() => {
    return appsRaw.filter((app) => {
      // Status filter
      if (statusFilter !== "all" && app.status !== statusFilter) return false;

      const parsed = parseApplicationNote(app.note);
      const user = userMap.get(app.userId);
      const exp = expMap.get(app.experienceId);

      // Café filter (matches parsed venue or known cafe names)
      if (cafeFilter !== "all") {
        const venueNorm = (parsed.venue || "").toLowerCase();
        if (cafeFilter === "c-hot-stag-del" && !venueNorm.includes("hot stag")) return false;
        if (cafeFilter === "c-karmala-del" && !venueNorm.includes("karma")) return false;
        if (cafeFilter === "other" && (venueNorm.includes("hot stag") || venueNorm.includes("karma"))) return false;
      }

      // Experience filter
      if (expFilter !== "all") {
        if (app.experienceId !== expFilter && !parsed.experienceTitle.toLowerCase().includes(expFilter.toLowerCase())) {
          return false;
        }
      }

      // Search query (matches member name, email, or application ID)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const userName = `${user?.firstName || ""} ${user?.bio || ""}`.toLowerCase();
        const userEmail = (user?.email || "").toLowerCase();
        const appId = app.id.toLowerCase();
        const venueText = parsed.venue.toLowerCase();
        const expTitle = (exp?.title || parsed.experienceTitle).toLowerCase();

        const matches =
          userName.includes(q) ||
          userEmail.includes(q) ||
          appId.includes(q) ||
          venueText.includes(q) ||
          expTitle.includes(q);

        if (!matches) return false;
      }

      return true;
    });
  }, [appsRaw, statusFilter, cafeFilter, expFilter, searchQuery, userMap, expMap]);

  const users = all.filter((u) => u.id !== session?.userId);

  const submitDecision = async () => {
    if (!decideFor) return;
    const { app, next } = decideFor;
    try {
      await db.setApplicationStatus(app.id, next, adminNote.trim() || null, actor);
      setDecideFor(null);
      setAdminNote("");
      refreshApps();
      toast(`Application → ${next.replace("_", " ")}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update application", "rose");
    }
  };

  const openBooking = (app: DateApplication) => {
    const parsed = parseApplicationNote(app.note);
    const exp = expMap.get(app.experienceId);
    setBookingFor(app);
    setPartnerId("");

    // Detect matched cafe id if any
    let matchedCafeId = "";
    if (parsed.venue.toLowerCase().includes("hot stag")) matchedCafeId = "c-hot-stag-del";
    else if (parsed.venue.toLowerCase().includes("karma")) matchedCafeId = "c-karmala-del";

    setCafeId(matchedCafeId);
    setVenue(parsed.venue || (exp ? `${exp.title} — select venue below` : ""));
    setDate(app.slotDate);
    setTime(app.slotTime);
    setAmount(String(exp?.priceFrom ?? 3500));
  };

  const submitBooking = async () => {
    if (!bookingFor) return;
    if (!partnerId) return toast("Select the matched partner", "rose");
    if (!venue.trim()) return toast("Enter the venue", "rose");
    if (!date || !time) return toast("Choose date and time", "rose");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return toast("Enter a valid amount", "rose");
    const partner = userMap.get(partnerId);
    try {
      await db.createBooking(
        {
          userId: bookingFor.userId,
          partnerId,
          experienceId: bookingFor.experienceId,
          cafeId: cafeId || null,
          date,
          time,
          venue: venue.trim(),
          status: "upcoming",
          amount: amt,
          paymentStatus: "pending",
        },
        actor,
      );
      await db.setApplicationStatus(bookingFor.id, "confirmed", `Confirmed with ${partner?.firstName ?? "partner"}`, actor);
      setBookingFor(null);
      refreshApps();
      toast("Booking confirmed — both members notified", "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create booking", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Experiences → Applications"
          title="Experience Applications"
          sub="Review submitted partner café experience applications, verify preferred timing and budget ranges, and manage approval status."
          align="left"
        />
        {error?.includes("MIGRATION_REQUIRED") ? (
          <MigrationAlertBanner
            migrationId="002"
            migrationFile="db/migrations/002_client_parity.sql"
            featureName="Experience Applications"
            description="The database table public.date_applications is not installed in your Supabase backend. Please execute Migration 002 in your Supabase Dashboard SQL Editor."
            onRefresh={refreshApps}
          />
        ) : error ? (
          <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load applications: {error}</p>
        ) : null}

        {/* Filter & Search Bar */}
        <div className="mt-8 glass rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="flex-1 min-w-[240px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by member name, email, café, or ID…"
              className={inputCls}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${inputCls} !py-2 text-xs max-w-[150px]`}
            >
              <option value="all">All statuses</option>
              {(["submitted", "under_review", "eligible", "selected", "confirmed", "completed", "declined", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>

            {/* Café Venue Filter */}
            <select
              value={cafeFilter}
              onChange={(e) => setCafeFilter(e.target.value)}
              className={`${inputCls} !py-2 text-xs max-w-[160px]`}
            >
              <option value="all">All Cafés</option>
              <option value="c-hot-stag-del">Café Hot Stag</option>
              <option value="c-karmala-del">Karma La Cafe</option>
              <option value="other">Other Venues</option>
            </select>

            {/* Experience Filter */}
            <select
              value={expFilter}
              onChange={(e) => setExpFilter(e.target.value)}
              className={`${inputCls} !py-2 text-xs max-w-[160px]`}
            >
              <option value="all">All Experiences</option>
              <option value="Premium Date">Premium Date</option>
              <option value="Premium Coffee Date">Premium Coffee Date</option>
              <option value="Italian Cuisine Date">Italian Cuisine Date</option>
              <option value="Karaoke">Live Karaoke</option>
            </select>

            <span className="text-xs text-mist pl-2 whitespace-nowrap">
              {filteredApps.length} of {appsRaw.length} applications
            </span>
          </div>
        </div>

        {/* Applications Table */}
        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No applications found"
                body={
                  searchQuery || statusFilter !== "all" || cafeFilter !== "all" || expFilter !== "all"
                    ? "Try adjusting your search criteria or resetting filters."
                    : "When members apply for curated café experiences, their applications appear here."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Café / Venue</th>
                    <th className={thCls}>Experience</th>
                    <th className={thCls}>Slot & Party</th>
                    <th className={thCls}>Budget Range</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Applied</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((a) => {
                    const u = userMap.get(a.userId);
                    const exp = expMap.get(a.experienceId);
                    const parsed = parseApplicationNote(a.note);
                    return (
                      <tr key={a.id} className={rowCls}>
                        {/* Member */}
                        <td className={tdCls}>
                          <p className="text-ivory font-medium whitespace-nowrap">
                            {u?.firstName || "Unknown Member"} {u ? `(${u.age})` : ""}
                          </p>
                          <p className="text-xs text-mist">{u?.email || u?.city || "Member"}</p>
                        </td>

                        {/* Café / Venue */}
                        <td className={`${tdCls} text-ivory font-medium whitespace-nowrap`}>
                          {parsed.venue || "Partner Café"}
                        </td>

                        {/* Experience */}
                        <td className={`${tdCls} text-champagne whitespace-nowrap`}>
                          {parsed.experienceTitle || exp?.title || a.experienceId}
                        </td>

                        {/* Slot & Party */}
                        <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>
                          <div>{a.slotDate} · {a.slotTime}</div>
                          <span className="text-xs text-mist">
                            {parsed.guestCount ? `${parsed.guestCount} Guests` : "2 Guests"}
                          </span>
                        </td>

                        {/* Budget Range */}
                        <td className={`${tdCls} text-champagne font-medium whitespace-nowrap`}>
                          {parsed.budgetRange ? (
                            <span>{parsed.budgetRange}</span>
                          ) : (
                            <span className="text-mist text-xs">Standard</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[a.status]}>{a.status.replace("_", " ")}</Badge>
                          {a.adminNote && <p className="text-xs text-mist mt-1 line-clamp-1">{a.adminNote}</p>}
                        </td>

                        {/* Applied Date */}
                        <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(a.createdAt)}</td>

                        {/* Actions */}
                        <td className={tdCls}>
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* View details button */}
                            <button
                              type="button"
                              onClick={() => setViewDetailApp(a)}
                              className="text-xs text-champagne hover:text-rosegold font-medium underline underline-offset-2 whitespace-nowrap"
                            >
                              View details
                            </button>

                            {/* Status transitions */}
                            {(NEXT[a.status] ?? []).map((n) =>
                              n === "confirmed" ? (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => openBooking(a)}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 font-medium whitespace-nowrap"
                                >
                                  Confirm booking
                                </button>
                              ) : (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => setDecideFor({ app: a, next: n })}
                                  className={`text-xs whitespace-nowrap font-medium ${
                                    n === "declined"
                                      ? "text-rosegold hover:text-champagne"
                                      : "text-ivory-dim hover:text-ivory"
                                  }`}
                                >
                                  {n === "under_review" ? "Review" : `→ ${n.replace("_", " ")}`}
                                </button>
                              ),
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 12-POINT FULL APPLICATION DETAIL MODAL                          */}
      {/* ============================================================== */}
      <AnimatePresence>
        {viewDetailApp && (() => {
          const u = userMap.get(viewDetailApp.userId);
          const exp = expMap.get(viewDetailApp.experienceId);
          const parsed = parseApplicationNote(viewDetailApp.note);

          return (
            <Modal
              open
              onClose={() => setViewDetailApp(null)}
              title="Application Details"
              wide
            >
              <div className="space-y-6">
                <div className="glass rounded-2xl p-5 border border-white/10 space-y-4">
                  {/* Point 1: Application ID */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">1. Application ID</span>
                    <span className="text-xs font-mono text-champagne font-medium">{viewDetailApp.id}</span>
                  </div>

                  {/* Point 2: User details */}
                  <div className="flex items-start justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">2. User Details</span>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ivory">
                        {u?.firstName || "Member"} {u ? `(${u.age}, ${u.gender})` : ""}
                      </p>
                      <p className="text-xs text-mist">{u?.email || "No email"}</p>
                      <p className="text-xs text-mist">{u?.city || "Delhi"}</p>
                    </div>
                  </div>

                  {/* Point 3: Café details */}
                  <div className="flex items-start justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">3. Café Venue</span>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-ivory">
                        {parsed.venue || "Partner Café"}
                      </p>
                    </div>
                  </div>

                  {/* Point 4: Experience type */}
                  <div className="flex items-start justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">4. Experience Type</span>
                    <span className="text-sm font-semibold text-champagne text-right">
                      {parsed.experienceTitle || exp?.title || viewDetailApp.experienceId}
                    </span>
                  </div>

                  {/* Point 5: Preferred date */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">5. Preferred Date</span>
                    <span className="text-sm text-ivory font-medium">{viewDetailApp.slotDate}</span>
                  </div>

                  {/* Point 6: Preferred time */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">6. Preferred Time</span>
                    <span className="text-sm text-ivory font-medium">
                      {viewDetailApp.slotTime} (Subject to confirmation)
                    </span>
                  </div>

                  {/* Point 7: Guest count */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">7. Guest Count</span>
                    <span className="text-sm text-ivory font-medium">
                      {parsed.guestCount ? `${parsed.guestCount} Guests` : "2 Guests"}
                    </span>
                  </div>

                  {/* Points 8 & 9: Selected Budget Range */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">8 & 9. Selected Budget Range</span>
                    <span className="text-sm font-semibold text-champagne">
                      {parsed.budgetRange || "Standard range"}
                    </span>
                  </div>

                  {/* Point 10: Additional note */}
                  <div className="border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist block mb-1">
                      10. Member Special Requests / Notes
                    </span>
                    <p className="text-xs text-ivory-dim italic bg-black/20 p-2.5 rounded-lg">
                      {parsed.userNote || "None provided"}
                    </p>
                  </div>

                  {/* Point 11: Submission timestamp */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-xs uppercase tracking-wider text-mist">11. Submission Timestamp</span>
                    <span className="text-xs text-mist">{fmtDate(viewDetailApp.createdAt)}</span>
                  </div>

                  {/* Point 12: Current application status */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-mist">12. Current Status</span>
                    <Badge tone={STATUS_TONES[viewDetailApp.status]}>
                      {viewDetailApp.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {viewDetailApp.adminNote && (
                    <div className="pt-2">
                      <span className="text-xs uppercase tracking-wider text-mist block mb-1">
                        Admin Note on Record
                      </span>
                      <p className="text-xs text-champagne bg-champagne/10 p-2.5 rounded-lg border border-champagne/20">
                        {viewDetailApp.adminNote}
                      </p>
                    </div>
                  )}
                </div>

                {/* Modal Footer Actions */}
                <div className="flex justify-between items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setViewDetailApp(null)}
                    className="btn-ghost rounded-full px-6 py-2.5 text-xs text-mist hover:text-ivory"
                  >
                    Close
                  </button>

                  <div className="flex items-center gap-2">
                    {viewDetailApp.status !== "declined" && viewDetailApp.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = viewDetailApp;
                          setViewDetailApp(null);
                          setDecideFor({ app: target, next: "declined" });
                        }}
                        className="btn-ghost text-rosegold hover:text-champagne border border-rosegold/30 rounded-full px-4 py-2 text-xs"
                      >
                        Decline Application
                      </button>
                    )}

                    {viewDetailApp.status === "submitted" && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = viewDetailApp;
                          setViewDetailApp(null);
                          setDecideFor({ app: target, next: "under_review" });
                        }}
                        className="btn-gold rounded-full px-5 py-2 text-xs font-semibold"
                      >
                        Mark Under Review
                      </button>
                    )}

                    {viewDetailApp.status === "under_review" && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = viewDetailApp;
                          setViewDetailApp(null);
                          setDecideFor({ app: target, next: "eligible" });
                        }}
                        className="btn-gold rounded-full px-5 py-2 text-xs font-semibold"
                      >
                        Mark Eligible
                      </button>
                    )}

                    {(viewDetailApp.status === "eligible" || viewDetailApp.status === "selected") && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = viewDetailApp;
                          setViewDetailApp(null);
                          openBooking(target);
                        }}
                        className="btn-gold rounded-full px-5 py-2 text-xs font-semibold"
                      >
                        Proceed to Booking
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Modal>
          );
        })()}
      </AnimatePresence>

      {/* Confirmation & Status Transition Modal */}
      <AnimatePresence>
        {decideFor && (
          <Modal open onClose={() => setDecideFor(null)} title={`Confirm: Move to ${decideFor.next.replace("_", " ")}`}>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Are you sure you want to change the status of application{" "}
                <span className="font-mono text-xs text-champagne">{decideFor.app.id}</span> by{" "}
                <span className="text-ivory font-semibold">{userMap.get(decideFor.app.userId)?.firstName || "Applicant"}</span> to{" "}
                <strong className="text-champagne uppercase">{decideFor.next.replace("_", " ")}</strong>?
              </p>
              <Field label="Admin note (optional)" hint="Shared with the member and stored on the audit record.">
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className={`${inputCls} min-h-20`}
                  placeholder="Reason for decision, date availability notes…"
                />
              </Field>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDecideFor(null)}
                  className="btn-ghost rounded-xl px-5 py-2.5 text-sm flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitDecision}
                  className="btn-gold rounded-xl px-6 py-2.5 text-sm font-semibold flex-1"
                >
                  Confirm Decision
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Booking Confirmation Modal */}
      <AnimatePresence>
        {bookingFor && (
          <Modal open onClose={() => setBookingFor(null)} title="Confirm Booking & Reservation" wide>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Manually selecting participants for{" "}
                <span className="text-champagne font-semibold">{expMap.get(bookingFor.experienceId)?.title || "Curated Experience"}</span>.
                Booking creates calendar confirmation and notifications.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Member (Applicant)">
                  <input
                    value={userMap.get(bookingFor.userId)?.firstName ?? ""}
                    disabled
                    className={inputCls}
                  />
                </Field>
                <Field label="Partner (Paired Member)">
                  <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className={inputCls}>
                    <option value="">Select partner…</option>
                    {users
                      .filter((u) => u.id !== bookingFor.userId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName}, {u.age} — {u.city}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Café / Venue Partner">
                  <select value={cafeId} onChange={(e) => setCafeId(e.target.value)} className={inputCls}>
                    <option value="">No café link</option>
                    {cafes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.city}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Venue Name & Address">
                  <input value={venue} onChange={(e) => setVenue(e.target.value)} className={inputCls} placeholder="Venue details" />
                </Field>
                <Field label="Date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Time">
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Amount (₹)" hint="Payable for the experience.">
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className={inputCls} />
                </Field>
              </div>
              <p className="text-xs text-mist">Amount shown: {inr(Number(amount) || 0)} · payment status starts as pending.</p>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBookingFor(null)}
                  className="btn-ghost rounded-xl px-5 py-3 text-sm flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitBooking}
                  className="btn-gold rounded-xl px-6 py-3 text-sm font-semibold flex-1"
                >
                  Create Booking & Confirm
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
