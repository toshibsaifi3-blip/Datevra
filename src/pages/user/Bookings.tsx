import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import { inr, useDbRefresh } from "./shared";
import type {
  AutomaticDateOffer,
  DateBooking,
  DateExperience,
  DateInvitation,
  ManualDateOffer,
  UserProfile,
} from "../../lib/types";

const PAY_TONE: Record<DateBooking["paymentStatus"], "gold" | "rose" | "muted" | "green"> = {
  pending: "gold",
  paid: "green",
  refunded: "muted",
};

const OFFER_TONE: Record<string, "gold" | "rose" | "muted" | "green"> = {
  offered: "gold",
  accepted: "green",
  booked: "green",
  declined: "muted",
  expired: "muted",
  cancelled: "rose",
  pending: "gold",
  sent: "gold",
  confirmed: "green",
};

interface BookingRow {
  booking: DateBooking;
  exp: DateExperience | undefined;
  partner: UserProfile | null;
}

interface BookingsBundle {
  upcoming: BookingRow[];
  past: BookingRow[];
  autoOffers: Array<{ offer: AutomaticDateOffer; partner: UserProfile | null; expTitle: string }>;
  manualOffers: Array<{ offer: ManualDateOffer; partner: UserProfile | null; expTitle: string }>;
  invitations: DateInvitation[];
}

function fmtResponse(r: boolean | null): string {
  if (r === true) return "accepted";
  if (r === false) return "declined";
  return "pending";
}

function BookingCard({ booking, exp, partner }: BookingRow) {
  return (
    <div className="glass rounded-3xl p-4 sm:p-6 card-hover">
      <div className="flex flex-wrap items-start gap-4">
        <span className="h-12 w-12 rounded-2xl bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/30 flex items-center justify-center text-xl text-champagne shrink-0">
          ◈
        </span>
        <div className="flex-1 min-w-0 sm:min-w-[200px]">
          <p className="font-display text-xl text-ivory">{exp?.title ?? "Curated date"}</p>
          <p className="text-sm text-mist mt-1">
            {booking.venue}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-ivory-dim">
            <span>📅 {booking.date}</span>
            <span>🕰 {booking.time}</span>
            {partner && <span>with {partner.firstName}</span>}
          </div>
          {booking.amount > 0 && (
            <p className="text-sm text-champagne mt-2">{inr(booking.amount)}</p>
          )}
        </div>
        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2">
          <Badge tone={booking.status === "upcoming" ? "gold" : booking.status === "completed" ? "green" : "muted"}>
            {booking.status}
          </Badge>
          <Badge tone={PAY_TONE[booking.paymentStatus]}>{booking.paymentStatus}</Badge>
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const { user } = useAuth();
  const db = useBackend();
  const { toast } = useToast();
  const tick = useDbRefresh("bookings", "date_offers", "invitations");
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<BookingsBundle> => {
      if (!user) return { upcoming: [], past: [], autoOffers: [], manualOffers: [], invitations: [] };
      const [all, autoList, manualList, invites] = await Promise.all([
        b.bookingsFor(user.id),
        b.myAutomaticDateOffers(user.id).catch(() => [] as AutomaticDateOffer[]),
        b.myManualDateOffers(user.id).catch(() => [] as ManualDateOffer[]),
        b.myDateInvitations(user.id).catch(() => [] as DateInvitation[]),
      ]);
      const exps = await Promise.all(all.map((x) => b.getExperience(x.experienceId)));
      const parts = await Promise.all(
        all.map((x) => (x.partnerId ? b.getUser(x.partnerId) : Promise.resolve(undefined))),
      );
      const rows: BookingRow[] = all.map((booking, i) => ({
        booking,
        exp: exps[i],
        partner: parts[i] ?? null,
      }));

      const [autoPartners, autoExps, manualPartners, manualExps] = await Promise.all([
        Promise.all(
          autoList.map((o) => {
            const otherId = o.userA === user.id ? o.userB : o.userA;
            return b.getUser(otherId).catch(() => undefined);
          }),
        ),
        Promise.all(autoList.map((o) => b.getExperience(o.experienceId).catch(() => undefined))),
        Promise.all(
          manualList.map((o) => {
            const otherId = o.userA === user.id ? o.userB : o.userA;
            return b.getUser(otherId).catch(() => undefined);
          }),
        ),
        Promise.all(manualList.map((o) => b.getExperience(o.experienceId).catch(() => undefined))),
      ]);

      return {
        upcoming: rows.filter((r) => r.booking.status === "upcoming"),
        past: rows.filter((r) => r.booking.status !== "upcoming"),
        autoOffers: autoList.map((offer, i) => ({
          offer,
          partner: autoPartners[i] ?? null,
          expTitle: autoExps[i]?.title ?? "Milestone Curated Date",
        })),
        manualOffers: manualList.map((offer, i) => ({
          offer,
          partner: manualPartners[i] ?? null,
          expTitle: manualExps[i]?.title ?? "Concierge Curated Date",
        })),
        invitations: invites,
      };
    },
    [user?.id, tick],
    { upcoming: [], past: [], autoOffers: [], manualOffers: [], invitations: [] } as BookingsBundle,
  );

  if (!user) return null;
  const { upcoming, past, autoOffers, manualOffers, invitations } = data;

  const respondAuto = async (offerId: string, accept: boolean) => {
    setBusyId(offerId);
    try {
      const updated = await db.respondToAutomaticDateOffer(offerId, user.id, accept);
      if (updated.status === "expired") {
        toast("This automatic date offer has expired.", "rose");
      } else if (updated.status === "cancelled") {
        toast("This date offer is no longer available and was cancelled.", "rose");
      } else if (updated.status === "accepted" && updated.bookingId) {
        toast("Both accepted! Your curated date booking is confirmed.", "gold");
      } else if (accept) {
        toast("Accepted! Waiting for your match to confirm.", "gold");
      } else {
        toast("Automatic date offer declined.", "rose");
      }
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update offer", "rose");
    } finally {
      setBusyId(null);
    }
  };

  const respondManual = async (offerId: string, accept: boolean) => {
    setBusyId(offerId);
    try {
      const updated = await db.respondToManualDateOffer(offerId, user.id, accept);
      if (updated.status === "expired") {
        toast("This date offer has expired.", "rose");
      } else if (updated.status === "cancelled") {
        toast("This date offer is no longer available and was cancelled.", "rose");
      } else if (updated.status === "accepted" && updated.bookingId) {
        toast("Both accepted! Your concierge date booking is confirmed.", "gold");
      } else if (accept) {
        toast("Accepted! Waiting for your match to confirm.", "gold");
      } else {
        toast("Date offer declined.", "rose");
      }
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update date offer", "rose");
    } finally {
      setBusyId(null);
    }
  };

  const respondInvitation = async (invitationId: string, accept: boolean) => {
    setBusyId(invitationId);
    try {
      const updated = await db.respondToDateInvitation(invitationId, user.id, accept);
      if (updated.response === "expired") {
        toast("This invitation has expired.", "rose");
      } else if (updated.response === "accepted" && updated.bookingId) {
        toast("Both accepted! Your paired date booking is confirmed.", "gold");
      } else if (updated.response === "accepted") {
        toast("Invitation accepted!", "gold");
      } else {
        toast(accept ? "Invitation could not be accepted." : "Invitation declined.", "rose");
      }
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update invitation", "rose");
    } finally {
      setBusyId(null);
    }
  };

  const hasAny =
    upcoming.length > 0 ||
    past.length > 0 ||
    autoOffers.length > 0 ||
    manualOffers.length > 0 ||
    invitations.length > 0;

  return (
    <div className="max-w-4xl mx-auto px-0 sm:px-4 py-4 sm:py-8">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Dates & invitations</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-8">Your Datevra calendar</h1>
      </Reveal>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load bookings: {error}</p>
      ) : (
        <>
          {/* Automatic Date Offers (100-Match Milestone) */}
          {autoOffers.length > 0 && (
            <section className="mb-10">
              <Reveal>
                <p className="text-[0.68rem] uppercase tracking-[0.26em] text-champagne">Milestone Date Offers</p>
                <h2 className="font-display text-xl text-ivory mt-1 mb-4">Automatic curated offers</h2>
              </Reveal>
              <div className="space-y-4">
                {autoOffers.map(({ offer, partner, expTitle }) => {
                  const myResp = offer.userA === user.id ? offer.userAResponse : offer.userBResponse;
                  const otherResp = offer.userA === user.id ? offer.userBResponse : offer.userAResponse;
                  const canRespond = offer.status === "pending" && myResp === null;
                  return (
                    <Reveal key={offer.id}>
                      <div className="glass-strong glow-border rounded-3xl p-4 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="gold">✦ 100-Match Milestone Offer</Badge>
                              <Badge tone={OFFER_TONE[offer.status] ?? "muted"}>{offer.status}</Badge>
                            </div>
                            <p className="font-display text-xl text-ivory mt-2">
                              {expTitle}{partner ? ` with ${partner.firstName}` : ""}
                            </p>
                            <p className="text-sm text-mist mt-1">
                              {offer.venue}{offer.suggestedDate ? ` · ${offer.suggestedDate}` : ""}{offer.suggestedTime ? ` at ${offer.suggestedTime}` : ""}
                            </p>
                            {offer.message && (
                              <p className="text-sm text-ivory-dim mt-2 leading-relaxed">{offer.message}</p>
                            )}
                            <p className="text-xs text-mist mt-2">
                              Your response: <span className="text-ivory">{fmtResponse(myResp)}</span> · Partner:{" "}
                              <span className="text-ivory">{fmtResponse(otherResp)}</span> · No automatic charge
                            </p>
                          </div>
                          {canRespond && (
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={busyId === offer.id}
                                onClick={() => respondAuto(offer.id, false)}
                                className="btn-ghost rounded-full px-4 py-2 min-h-[44px] text-sm"
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                disabled={busyId === offer.id}
                                onClick={() => respondAuto(offer.id, true)}
                                className="btn-gold rounded-full px-5 py-2 min-h-[44px] text-sm font-medium"
                              >
                                {busyId === offer.id ? "Saving…" : "Accept date"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </section>
          )}

          {/* Manual Concierge Date Offers */}
          {manualOffers.length > 0 && (
            <section className="mb-10">
              <Reveal>
                <p className="text-[0.68rem] uppercase tracking-[0.26em] text-rosegold">Concierge Curated</p>
                <h2 className="font-display text-xl text-ivory mt-1 mb-4">Personal date offers</h2>
              </Reveal>
              <div className="space-y-4">
                {manualOffers.map(({ offer, partner, expTitle }) => {
                  const myResp = offer.userA === user.id ? offer.userAResponse : offer.userBResponse;
                  const otherResp = offer.userA === user.id ? offer.userBResponse : offer.userAResponse;
                  const canRespond = offer.status === "pending" && myResp === null;
                  return (
                    <Reveal key={offer.id}>
                      <div className="glass rounded-3xl p-4 sm:p-6 border border-rosegold/25">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="rose">Concierge Date Offer</Badge>
                              <Badge tone={OFFER_TONE[offer.status] ?? "muted"}>{offer.status}</Badge>
                            </div>
                            <p className="font-display text-xl text-ivory mt-2">
                              {expTitle}{partner ? ` with ${partner.firstName}` : ""}
                            </p>
                            <p className="text-sm text-mist mt-1">
                              {offer.venue} · 📅 {offer.suggestedDate} · 🕰 {offer.suggestedTime}
                            </p>
                            {offer.message && (
                              <p className="text-sm text-ivory-dim mt-2 leading-relaxed">{offer.message}</p>
                            )}
                            <p className="text-xs text-mist mt-2">
                              Your response: <span className="text-ivory">{fmtResponse(myResp)}</span> · Partner:{" "}
                              <span className="text-ivory">{fmtResponse(otherResp)}</span>
                            </p>
                          </div>
                          {canRespond && (
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={busyId === offer.id}
                                onClick={() => respondManual(offer.id, false)}
                                className="btn-ghost rounded-full px-4 py-2 min-h-[44px] text-sm"
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                disabled={busyId === offer.id}
                                onClick={() => respondManual(offer.id, true)}
                                className="btn-gold rounded-full px-5 py-2 min-h-[44px] text-sm font-medium"
                              >
                                {busyId === offer.id ? "Saving…" : "Accept date"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </section>
          )}

          {/* Private Date Invitations (Individual / Group / Pair) */}
          {invitations.length > 0 && (
            <section className="mb-10">
              <Reveal>
                <p className="text-[0.68rem] uppercase tracking-[0.26em] text-champagne">Private Invitations</p>
                <h2 className="font-display text-xl text-ivory mt-1 mb-4">Exclusive Datevra invitations</h2>
              </Reveal>
              <div className="space-y-4">
                {invitations.map((inv) => {
                  const myRow = inv.recipients.find((r) => r.userId === user.id);
                  const myResp = myRow?.response ?? "pending";
                  const canRespond = inv.status === "active" && myResp === "pending";
                  return (
                    <Reveal key={inv.id}>
                      <div className="glass rounded-3xl p-4 sm:p-6 border border-champagne/25">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="gold">
                                {inv.invitationMode === "pair"
                                  ? "Paired Invitation"
                                  : inv.invitationMode === "group"
                                    ? "Curated Event Invitation"
                                    : "Personal Invitation"}
                              </Badge>
                              <Badge tone={OFFER_TONE[myResp] ?? "muted"}>{myResp}</Badge>
                            </div>
                            <p className="font-display text-xl text-ivory mt-2">{inv.title}</p>
                            <p className="text-sm text-mist mt-1">
                              {inv.venue} · 📅 {inv.date} · 🕰 {inv.time}
                            </p>
                            {inv.message && (
                              <p className="text-sm text-ivory-dim mt-2 leading-relaxed">“{inv.message}”</p>
                            )}
                          </div>
                          {canRespond && (
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={busyId === inv.id}
                                onClick={() => respondInvitation(inv.id, false)}
                                className="btn-ghost rounded-full px-4 py-2 min-h-[44px] text-sm"
                              >
                                Decline
                              </button>
                              <button
                                type="button"
                                disabled={busyId === inv.id}
                                onClick={() => respondInvitation(inv.id, true)}
                                className="btn-gold rounded-full px-5 py-2 min-h-[44px] text-sm font-medium"
                              >
                                {busyId === inv.id ? "Saving…" : "Accept invite"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Reveal>
                  );
                })}
              </div>
            </section>
          )}

          <Reveal>
            <h2 className="font-display text-xl text-ivory mb-4">Upcoming bookings</h2>
          </Reveal>
          {upcoming.length === 0 ? (
            <p className="text-sm text-mist mb-8">
              Nothing scheduled yet. Confirmed experiences and mutually accepted date offers will appear here.
            </p>
          ) : (
            <div className="space-y-4 mb-10">
              {upcoming.map((r) => (
                <Reveal key={r.booking.id}>
                  <BookingCard booking={r.booking} exp={r.exp} partner={r.partner} />
                </Reveal>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <Reveal>
                <h2 className="font-display text-xl text-ivory mb-4">Past</h2>
              </Reveal>
              <div className="space-y-4 opacity-80">
                {past.map((r) => (
                  <Reveal key={r.booking.id}>
                    <BookingCard booking={r.booking} exp={r.exp} partner={r.partner} />
                  </Reveal>
                ))}
              </div>
            </>
          )}

          {!hasAny && (
            <EmptyState
              title="No bookings or invitations yet"
              body="Apply for a curated experience and, once our team confirms your date or sends an invitation, the details will live here."
              action={
                <Link to="/experiences" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
                  Explore experiences
                </Link>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

