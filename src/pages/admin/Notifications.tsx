import { useEffect, useState } from "react";
import type { AppNotification, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, Field, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

const KIND_TONES: Record<string, "gold" | "rose" | "muted" | "green"> = {
  match: "rose",
  like: "rose",
  message: "muted",
  membership: "gold",
  payment: "gold",
  experience: "gold",
  booking: "gold",
  safety: "rose",
  system: "muted",
};

export default function Notifications() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [sent, setSent] = useState<{ title: string; at: string; count: number }[]>([]);

  const { data: adminNotes, loading, error, refresh } = useAsync(
    (b) => b.notificationsFor("admin-1"),
    [db],
    [] as AppNotification[],
  );
  const { data: all } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => db.subscribe("notifications", refresh), [db, refresh]);

  const broadcast = async () => {
    if (!title.trim()) return toast("Enter a broadcast title", "rose");
    if (!body.trim()) return toast("Enter a broadcast message", "rose");
    const users = all.filter((u) => u.id !== session?.userId);
    try {
      for (const u of users) {
        await db.pushNotification({
          userId: u.id,
          kind: "system",
          title: title.trim(),
          body: body.trim().slice(0, 300),
          link: link.trim() || undefined,
        });
      }
      setSent((s) => [
        { title: title.trim(), at: new Date().toISOString(), count: users.length },
        ...s,
      ]);
      setTitle("");
      setBody("");
      setLink("");
      toast(`Broadcast sent to ${users.length} members`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Broadcast failed", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Member communication"
          title="Notifications"
          sub="Your admin inbox plus broadcast announcements to every member. Emails unlock once a provider is configured."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load inbox: {error}</p>}

        <div className="grid lg:grid-cols-2 gap-6 mt-10">
          <div className="glass rounded-3xl p-6">
            <h3 className="font-display text-xl text-ivory">Broadcast announcement</h3>
            <p className="text-xs text-mist mt-1">Pushes an in-app notification to all members</p>
            <div className="space-y-4 mt-5">
              <Field label="Title">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="New Elite evening in Hyderabad" />
              </Field>
              <Field label="Message">
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className={`${inputCls} min-h-24`} placeholder="What should members know?" />
              </Field>
              <Field label="Link (optional)" hint="In-app path, e.g. /app/experiences">
                <input value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} placeholder="/experiences" />
              </Field>
              <button onClick={broadcast} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Send broadcast
              </button>
            </div>
          </div>

          <div className="glass rounded-3xl p-6">
            <h3 className="font-display text-xl text-ivory">Recent broadcasts</h3>
            <p className="text-xs text-mist mt-1">sent this session</p>
            <div className="mt-5 space-y-3">
              {sent.length === 0 && (
                <p className="text-sm text-mist">No broadcasts sent yet.</p>
              )}
              {sent.map((s, i) => (
                <div key={`${s.at}-${i}`} className="glass rounded-2xl p-4">
                  <p className="text-ivory text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-mist mt-1">
                    {s.count} recipients · {fmtDate(s.at)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass rounded-3xl mt-8 overflow-hidden">
          <h3 className="font-display text-xl text-ivory px-6 pt-6">Admin inbox</h3>
          <p className="text-xs text-mist px-6 mt-1">system alerts routed to the Datevra team</p>
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : adminNotes.length === 0 ? (
            <p className="text-sm text-mist px-6 py-6">No admin notifications.</p>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr>
                    <th className={thCls}>Kind</th>
                    <th className={thCls}>Title</th>
                    <th className={thCls}>Body</th>
                    <th className={thCls}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {adminNotes.map((n) => (
                    <tr key={n.id} className={rowCls}>
                      <td className={tdCls}>
                        <Badge tone={KIND_TONES[n.kind] ?? "muted"}>{n.kind}</Badge>
                      </td>
                      <td className={`${tdCls} text-ivory whitespace-nowrap`}>{n.title}</td>
                      <td className={`${tdCls} text-ivory-dim max-w-[300px]`}>
                        <p className="line-clamp-2">{n.body}</p>
                      </td>
                      <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(n.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
