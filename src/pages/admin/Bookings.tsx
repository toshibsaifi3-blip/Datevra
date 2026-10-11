import { useEffect, useMemo, useState } from "react";
import type { BookingStatus, Cafe, DateBooking, DateExperience, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, EmptyState, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate, inr, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<BookingStatus, "gold" | "green" | "muted"> = {
  upcoming: "gold",
  completed: "green",
  cancelled: "muted",
};

const PAY_TONES: Record<DateBooking["paymentStatus"], "gold" | "green" | "muted"> = {
  pending: "gold",
  paid: "green",
  refunded: "muted",
};

export default function Bookings() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [statusFilter, setStatusFilter] = useState("all");
  const actor = session?.userId ?? "admin-1";

  const { data: bookingsRaw, loading, error, refresh } = useAsync(
    (b) => b.allBookings(),
    [db],
    [] as DateBooking[],
  );
  const { data: all } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);
  const { data: exps } = useAsync((b) => b.listExperiences(), [db], [] as DateExperience[]);

  useEffect(() => db.subscribe("bookings", refresh), [db, refresh]);

  const userMap = useMemo(() => new Map(all.map((u) => [u.id, u])), [all]);
  const cafeMap = useMemo(() => new Map(cafes.map((c) => [c.id, c])), [cafes]);
  const expMap = useMemo(() => new Map(exps.map((e) => [e.id, e])), [exps]);

  const bookings = bookingsRaw.filter((b) => statusFilter === "all" || b.status === statusFilter);

  const setStatus = async (b: DateBooking, status: BookingStatus) => {
    if (
      status === "cancelled" &&
      !window.confirm(`Cancel booking at ${b.venue} on ${b.date}? Members will be notified.`)
    )
      return;
    try {
      await db.setBookingStatus(b.id, status, actor);
      refresh();
      toast(`Booking → ${status}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update booking", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Curated dates"
          title="Bookings"
          sub="Every arranged date from confirmation to completion. Only participants and authorized staff see these details."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load bookings: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputCls} max-w-xs`}
          >
            <option value="all">All statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="text-sm text-mist">{bookings.length} bookings</span>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : bookings.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No bookings" body="Confirmed experience bookings appear here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr>
                    <th className={thCls}>Pair</th>
                    <th className={thCls}>Experience</th>
                    <th className={thCls}>Venue</th>
                    <th className={thCls}>When</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Payment</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const u = userMap.get(b.userId);
                    const p = b.partnerId ? userMap.get(b.partnerId) : null;
                    const exp = expMap.get(b.experienceId);
                    const cafe = b.cafeId ? cafeMap.get(b.cafeId) : null;
                    return (
                      <tr key={b.id} className={rowCls}>
                        <td className={tdCls}>
                          <p className="text-ivory whitespace-nowrap">
                            {u?.firstName} <span className="text-rosegold">✦</span> {p?.firstName ?? "—"}
                          </p>
                        </td>
                        <td className={`${tdCls} text-champagne whitespace-nowrap`}>{exp?.title ?? "—"}</td>
                        <td className={`${tdCls} text-ivory-dim max-w-[180px]`}>
                          <p className="line-clamp-1">{b.venue}</p>
                          {cafe && <p className="text-xs text-mist">{cafe.name}</p>}
                        </td>
                        <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>
                          {b.date} · {b.time}
                        </td>
                        <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{inr(b.amount)}</td>
                        <td className={tdCls}>
                          <Badge tone={PAY_TONES[b.paymentStatus]}>{b.paymentStatus}</Badge>
                        </td>
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[b.status]}>{b.status}</Badge>
                          <p className="text-xs text-mist mt-1">{fmtDate(b.createdAt)}</p>
                        </td>
                        <td className={tdCls}>
                          <div className="flex gap-2">
                            {b.status === "upcoming" && (
                              <>
                                <button
                                  onClick={() => setStatus(b, "completed")}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                                >
                                  Complete
                                </button>
                                <button
                                  onClick={() => setStatus(b, "cancelled")}
                                  className="text-xs text-rosegold hover:text-champagne whitespace-nowrap"
                                >
                                  Cancel
                                </button>
                              </>
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
    </div>
  );
}
