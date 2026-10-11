import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import { timeAgo, useDbRefresh } from "./shared";
import type { AppNotification, NotificationKind } from "../../lib/types";

const KIND_ICON: Record<NotificationKind, string> = {
  match: "♥",
  like: "✦",
  message: "✉",
  membership: "❖",
  payment: "₹",
  experience: "☕",
  booking: "◈",
  safety: "⚠",
  system: "✦",
  match_proposal: "💌",
  pass: "🎟",
};

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const tick = useDbRefresh("notifications");

  const {
    data: notifs,
    loading,
    error,
    refresh,
  } = useAsync(
    (b) =>
      user
        ? b.notificationsFor(user.id)
        : Promise.resolve([] as AppNotification[]),
    [user?.id, tick],
    [] as AppNotification[],
  );
  const unread = notifs.filter((n) => !n.read).length;

  if (!user) return null;

  const open = async (id: string, link?: string) => {
    try {
      await db.markNotificationRead(id);
      refresh();
    } catch {
      /* non-fatal — still navigate */
    }
    if (link) navigate(link);
  };

  const markAll = async () => {
    try {
      await db.markAllNotificationsRead(user.id);
      refresh();
      toast("All notifications marked as read.");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't update notifications.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Notifications</p>
          <h1 className="font-display text-3xl text-ivory mt-1">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </h1>
        </div>
        {unread > 0 && (
          <button onClick={markAll} className="btn-ghost rounded-full px-5 py-2.5 text-sm">
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">
          Couldn't load notifications: {error}
        </p>
      ) : notifs.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Matches, likes, messages and booking updates will appear in your notification centre."
        />
      ) : (
        <div className="space-y-3">
          {notifs.map((n) => (
            <Reveal key={n.id}>
              <button
                onClick={() => open(n.id, n.link)}
                className={`w-full text-left glass rounded-2xl p-4 flex gap-4 items-start transition-colors hover:border-rosegold/30 ${
                  n.read ? "opacity-70" : ""
                }`}
              >
                <span className="shrink-0 h-11 w-11 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/30 flex items-center justify-center text-champagne text-lg">
                  {KIND_ICON[n.kind]}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-ivory font-medium text-[0.95rem]">{n.title}</span>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-rosegold shrink-0" />}
                  </span>
                  <span className="block text-sm text-ivory-dim/90 mt-0.5">{n.body}</span>
                  <span className="block text-xs text-mist/70 mt-1">{timeAgo(n.createdAt)}</span>
                </span>
                {n.link && <span className="text-rosegold shrink-0 self-center">→</span>}
              </button>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
