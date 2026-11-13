import { useEffect, useState } from "react";
import type { ComplimentaryPass } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, EmptyState, Field, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate } from "../admin/_util";

export default function MyPasses() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const userId = session?.userId ?? "";
  const [code, setCode] = useState("");

  const { data: passes, loading, error, refresh } = useAsync(
    (b) => b.myComplimentaryPasses(userId), [db, userId], [] as ComplimentaryPass[],
  );

  useEffect(() => db.subscribe("passes", refresh), [db, refresh]);

  const redeem = async () => {
    if (!code.trim()) { toast("Enter a pass code", "rose"); return; }
    try {
      const pass = await db.redeemComplimentaryPass(code, userId);
      toast(`Pass redeemed at ${pass.cafeName}`, "gold");
      setCode("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not redeem", "rose");
    }
  };

  const active = passes.filter((p) => p.status === "active");
  const history = passes.filter((p) => p.status !== "active");

  return (
    <div className="px-0 sm:px-4 pb-10 sm:pb-24 pt-2 sm:pt-10 max-w-3xl mx-auto">
      <SectionHead
        kicker="Complimentary passes"
        title="My passes"
        sub="Redeem a pass code at the venue to enjoy your complimentary experience."
        align="left"
      />

      <div className="rounded-2xl border border-white/10 p-4 sm:p-5 mt-6 bg-white/[0.02]">
        <Field label="Have a pass code?">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={`${inputCls} min-w-0 flex-1 font-mono uppercase`} placeholder="DVR-XXXXXX" maxLength={10} />
            <button onClick={redeem} className="btn-gold rounded-full px-6 min-h-[44px] text-sm font-medium whitespace-nowrap shrink-0">Redeem</button>
          </div>
        </Field>
      </div>

      {loading ? <Skeleton /> : error ? (
        <EmptyState title="Could not load passes" body={error} />
      ) : (
        <>
          <h3 className="text-lg font-semibold mt-8 mb-3">Active passes ({active.length})</h3>
          {active.length === 0 ? (
            <p className="text-white/40 text-sm">No active passes right now.</p>
          ) : (
            <div className="grid gap-3">
              {active.map((p) => (
                <div key={p.id} className="rounded-2xl border border-champagne/30 p-4 sm:p-5 bg-gradient-to-br from-champagne/10 to-transparent">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-lg">{p.cafeName}</p>
                      {p.note && <p className="text-sm text-white/60 mt-1">{p.note}</p>}
                      {p.expiresAt && <p className="text-xs text-white/40 mt-1">Expires {fmtDate(p.expiresAt)}</p>}
                    </div>
                    <Badge tone="gold">Active</Badge>
                  </div>
                  <p className="font-mono text-xl sm:text-2xl text-champagne mt-3 tracking-wider sm:tracking-widest break-all">{p.code}</p>
                  <p className="text-xs text-white/40 mt-1">Show this code at the venue</p>
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <>
              <h3 className="text-lg font-semibold mt-8 mb-3 text-white/60">History</h3>
              <div className="grid gap-2">
                {history.map((p) => (
                  <div key={p.id} className="rounded-xl border border-white/5 p-4 flex flex-wrap justify-between items-center gap-2 opacity-60">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.cafeName}</p>
                      <p className="font-mono text-sm text-white/40 break-all">{p.code}</p>
                    </div>
                    <Badge tone={p.status === "redeemed" ? "green" : "muted"}>{p.status}</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
