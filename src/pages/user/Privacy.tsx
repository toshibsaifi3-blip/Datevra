import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, Reveal, useToast } from "../../components/ui";
import { useDbRefresh } from "./shared";

const DATA_STORED = [
  "Profile details you provide — name, age, city, bio, interests, hobbies, lifestyle notes",
  "Your photos and verification status",
  "Discovery preferences (age range, cities, intentions)",
  "Likes, passes, matches and saved profiles",
  "Private messages with your matches",
  "Membership, subscription and payment records",
  "Curated experience applications and bookings",
  "Reports you file and blocks you place",
];

export default function Privacy() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const tick = useDbRefresh("profiles", "blocks");

  const { data: blockedCount } = useAsync(
    (b) =>
      user ? b.blockedBy(user.id).then((x) => x.length) : Promise.resolve(0),
    [user?.id, tick],
    0,
  );

  if (!user) return null;
  const me = user;

  const toggleOnline = async () => {
    try {
      await db.updateUser(me.id, { online: !me.online });
      refresh();
      toast(me.online ? "You now appear offline." : "You now appear online.", "gold");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't update your status.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Privacy</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-2">Your data, your call</h1>
        <p className="text-sm text-mist mb-8">
          We never sell your data and never show your private details publicly. Here's what's in your hands.
        </p>
      </Reveal>

      {/* Online visibility */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl text-ivory">Online status</h2>
              <p className="text-sm text-mist mt-1 max-w-md">
                When on, your matches see a green dot and know you're around to chat.
              </p>
            </div>
            <button
              onClick={toggleOnline}
              role="switch"
              aria-checked={me.online}
              className={`relative h-8 w-14 rounded-full transition-colors shrink-0 ${
                me.online ? "bg-gradient-to-r from-rosegold to-champagne" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-midnight transition-all ${
                  me.online ? "left-7" : "left-1"
                }`}
              />
            </button>
          </div>
        </section>
      </Reveal>

      {/* Profile visibility */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <h2 className="font-display text-xl text-ivory mb-2">Who can see your profile</h2>
          <ul className="text-sm text-ivory-dim space-y-2 leading-relaxed">
            <li className="flex gap-2"><span className="text-rosegold">✦</span>Your profile appears in Discover only for people whose preferences you fit — and vice versa.</li>
            <li className="flex gap-2"><span className="text-rosegold">✦</span>Your full details are visible only to people browsing discovery; your email is never shown to anyone.</li>
            <li className="flex gap-2"><span className="text-rosegold">✦</span>Booking details are shared only with your date partner and the authorised Datevra team.</li>
            <li className="flex gap-2"><span className="text-rosegold">✦</span>Blocked people can't see you, message you, or appear in your discovery.</li>
          </ul>
          <Link to="/profile" className="btn-ghost rounded-full px-5 py-2 text-sm inline-block mt-5">
            Edit what others see →
          </Link>
        </section>
      </Reveal>

      {/* Blocked */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl text-ivory">Blocked users</h2>
              <p className="text-sm text-mist mt-1">
                {blockedCount === 0
                  ? "You haven't blocked anyone."
                  : `${blockedCount} ${blockedCount === 1 ? "person" : "people"} blocked.`}
              </p>
            </div>
            <Link to="/blocked" className="btn-ghost rounded-full px-5 py-2 text-sm shrink-0">
              Manage →
            </Link>
          </div>
        </section>
      </Reveal>

      {/* Data summary */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-display text-xl text-ivory">What we store about you</h2>
            <Badge tone="muted">Demo: this browser</Badge>
          </div>
          <ul className="space-y-2.5">
            {DATA_STORED.map((d) => (
              <li key={d} className="text-sm text-ivory-dim flex gap-2">
                <span className="text-rosegold">✦</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </section>
      </Reveal>

      {/* Deletion */}
      <Reveal>
        <section className="rounded-3xl p-6 md:p-8 border border-burgundy-soft/50 bg-burgundy-deep/20">
          <h2 className="font-display text-xl text-ivory mb-2">Delete your account</h2>
          <p className="text-sm text-ivory-dim mb-5">
            Want everything erased? Head to Settings → Danger zone to permanently delete your
            account and all personal data.
          </p>
          <Link to="/settings" className="rounded-full px-6 py-2.5 text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors inline-block">
            Go to Settings
          </Link>
        </section>
      </Reveal>
    </div>
  );
}
