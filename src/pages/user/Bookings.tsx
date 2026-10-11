import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync } from "../../lib/data";
import { Badge, EmptyState, Reveal, Skeleton } from "../../components/ui";
import { inr, useDbRefresh } from "./shared";
import type { DateBooking, DateExperience, UserProfile } from "../../lib/types";

const PAY_TONE: Record<DateBooking["paymentStatus"], "gold" | "rose" | "muted" | "green"> = {
  pending: "gold",
  paid: "green",
  refunded: "muted",
};

interface BookingRow {
  booking: DateBooking;
  exp: DateExperience | undefined;
  partner: UserProfile | null;
}

function BookingCard({ booking, exp, partner }: BookingRow) {
  return (
    <div className="glass rounded-3xl p-6 card-hover">
      <div className="flex flex-wrap items-start gap-4">
        <span className="h-12 w-12 rounded-2xl bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/30 flex items-center justify-center text-xl text-champagne shrink-0">
          ◈
        </span>
        <div className="flex-1 min-w-[200px]">
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
        <div className="flex flex-col items-end gap-2">
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
  const tick = useDbRefresh("bookings");

  const {
    data,
    loading,
    error,
  } = useAsync(
    async (b): Promise<{ upcoming: BookingRow[]; past: BookingRow[] }> => {
      if (!user) return { upcoming: [], past: [] };
      const all = await b.bookingsFor(user.id);
      const exps = await Promise.all(
        all.map((x) => b.getExperience(x.experienceId)),
      );
      const parts = await Promise.all(
        all.map((x) =>
          x.partnerId ? b.getUser(x.partnerId) : Promise.resolve(undefined),
        ),
      );
      const rows: BookingRow[] = all.map((booking, i) => ({
        booking,
        exp: exps[i],
        partner: parts[i] ?? null,
      }));
      return {
        upcoming: rows.filter((r) => r.booking.status === "upcoming"),
        past: rows.filter((r) => r.booking.status !== "upcoming"),
      };
    },
    [user?.id, tick],
    { upcoming: [], past: [] } as { upcoming: BookingRow[]; past: BookingRow[] },
  );

  if (!user) return null;
  const { upcoming, past } = data;

  return (
    <div className="max-w-4xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">My bookings</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-8">Dates on the calendar</h1>
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
          <Reveal>
            <h2 className="font-display text-xl text-ivory mb-4">Upcoming</h2>
          </Reveal>
          {upcoming.length === 0 ? (
            <p className="text-sm text-mist mb-8">
              Nothing scheduled yet. Confirmed experiences will appear here with venue and timing.
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

          {upcoming.length === 0 && past.length === 0 && (
            <EmptyState
              title="No bookings yet"
              body="Apply for a curated experience and, once our team confirms your date, the details will live here."
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
