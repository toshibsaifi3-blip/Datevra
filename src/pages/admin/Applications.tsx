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

export default function Applications() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [statusFilter, setStatusFilter] = useState("all");
  const [decideFor, setDecideFor] = useState<{ app: DateApplication; next: ApplicationStatus } | null>(null);
  const [adminNote, setAdminNote] = useState("");
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

  const apps = appsRaw.filter((a) => statusFilter === "all" || a.status === statusFilter);
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
    const exp = expMap.get(app.experienceId);
    setBookingFor(app);
    setPartnerId("");
    setCafeId("");
    setVenue(exp ? `${exp.title} — select venue below` : "");
    setDate(app.slotDate);
    setTime(app.slotTime);
    setAmount(String(exp?.priceFrom ?? 0));
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
          kicker="Curated experiences"
          title="Date Applications"
          sub="Manual selection workflow: submitted → under review → eligible → selected → confirmed → completed. Selection is never guaranteed."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load applications: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputCls} max-w-xs`}
          >
            <option value="all">All statuses</option>
            {(["submitted", "under_review", "eligible", "selected", "confirmed", "completed", "declined", "cancelled"] as const).map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <span className="text-sm text-mist">{apps.length} applications</span>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : apps.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No applications" body="When members apply for curated experiences, they queue here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[920px]">
                <thead>
                  <tr>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Experience</th>
                    <th className={thCls}>Slot</th>
                    <th className={thCls}>Note</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Applied</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => {
                    const u = userMap.get(a.userId);
                    const exp = expMap.get(a.experienceId);
                    return (
                      <tr key={a.id} className={rowCls}>
                        <td className={tdCls}>
                          <p className="text-ivory font-medium whitespace-nowrap">
                            {u?.firstName} {u ? `(${u.age})` : ""}
                          </p>
                          <p className="text-xs text-mist">{u?.city}</p>
                        </td>
                        <td className={`${tdCls} text-champagne whitespace-nowrap`}>{exp?.title ?? a.experienceId}</td>
                        <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>
                          {a.slotDate} · {a.slotTime}
                        </td>
                        <td className={`${tdCls} text-ivory-dim max-w-[180px]`}>
                          <p className="line-clamp-2">{a.note || "—"}</p>
                        </td>
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[a.status]}>{a.status.replace("_", " ")}</Badge>
                          {a.adminNote && <p className="text-xs text-mist mt-1 line-clamp-2">{a.adminNote}</p>}
                        </td>
                        <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(a.createdAt)}</td>
                        <td className={tdCls}>
                          <div className="flex gap-2 flex-wrap">
                            {(NEXT[a.status] ?? []).map((n) =>
                              n === "confirmed" ? (
                                <button
                                  key={n}
                                  onClick={() => openBooking(a)}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                                >
                                  Confirm booking
                                </button>
                              ) : (
                                <button
                                  key={n}
                                  onClick={() => setDecideFor({ app: a, next: n })}
                                  className={`text-xs whitespace-nowrap ${
                                    n === "declined"
                                      ? "text-rosegold hover:text-champagne"
                                      : "text-champagne hover:text-rosegold"
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

      <AnimatePresence>
        {decideFor && (
          <Modal open onClose={() => setDecideFor(null)} title={`Move to ${decideFor.next.replace("_", " ")}`}>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Application by{" "}
                <span className="text-ivory">{userMap.get(decideFor.app.userId)?.firstName}</span> for{" "}
                <span className="text-champagne">{expMap.get(decideFor.app.experienceId)?.title}</span>.
                The member is notified of this change.
              </p>
              <Field label="Admin note (optional)" hint="Shared with the member and stored on the record.">
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className={`${inputCls} min-h-20`}
                  placeholder="Why this decision? Eligibility notes…"
                />
              </Field>
              <button onClick={submitDecision} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Confirm decision
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bookingFor && (
          <Modal open onClose={() => setBookingFor(null)} title="Confirm booking" wide>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Manually selecting participants for{" "}
                <span className="text-champagne">{expMap.get(bookingFor.experienceId)?.title}</span>.
                Booking creates notifications for both members.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Member (applicant)">
                  <input
                    value={userMap.get(bookingFor.userId)?.firstName ?? ""}
                    disabled
                    className={inputCls}
                  />
                </Field>
                <Field label="Partner (paired member)">
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
                <Field label="Café / venue partner">
                  <select value={cafeId} onChange={(e) => setCafeId(e.target.value)} className={inputCls}>
                    <option value="">No café link</option>
                    {cafes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.city}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Venue name & address">
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
              <button onClick={submitBooking} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Create booking & confirm
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
