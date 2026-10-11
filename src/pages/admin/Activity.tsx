import { useEffect, useState } from "react";
import type { ActivityLog } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, SectionHead, Skeleton, inputCls } from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

export default function Activity() {
  const db = useBackend();
  const [query, setQuery] = useState("");

  const { data: logsRaw, loading, error, refresh } = useAsync(
    (b) => b.listActivity(),
    [db],
    [] as ActivityLog[],
  );

  useEffect(() => db.subscribe("activity", refresh), [db, refresh]);

  const logs = logsRaw.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${a.action} ${a.detail} ${a.actorId}`.toLowerCase().includes(q);
  });

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Audit trail"
          title="Activity Log"
          sub="Every admin and system action — immutable, newest first. Sensitive financial changes always appear here."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load activity: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, details, actors…"
            className={inputCls}
          />
          <span className="text-sm text-mist whitespace-nowrap">{logs.length} entries</span>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No activity" body="Admin actions will be recorded here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr>
                    <th className={thCls}>Time</th>
                    <th className={thCls}>Actor</th>
                    <th className={thCls}>Role</th>
                    <th className={thCls}>Action</th>
                    <th className={thCls}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((a) => (
                    <tr key={a.id} className={rowCls}>
                      <td className={`${tdCls} whitespace-nowrap text-mist`}>{fmtDate(a.createdAt)}</td>
                      <td className={`${tdCls} font-mono text-xs text-ivory-dim whitespace-nowrap`}>
                        {a.actorId}
                      </td>
                      <td className={tdCls}>
                        <Badge tone={a.actorRole === "admin" ? "gold" : "muted"}>{a.actorRole}</Badge>
                      </td>
                      <td className={`${tdCls} font-mono text-xs text-rosegold whitespace-nowrap`}>
                        {a.action}
                      </td>
                      <td className={`${tdCls} text-ivory-dim max-w-[420px]`}>{a.detail}</td>
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
