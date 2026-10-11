import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { InvestorRecord } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { EmptyState, Field, Modal, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDay, inr, newId, rowCls, tdCls, thCls } from "./_util";

const emptyForm: InvestorRecord = {
  id: "",
  name: "",
  agreementRef: "",
  sharePct: 0,
  schedule: "Quarterly",
  paidOut: 0,
  pending: 0,
  notes: "",
};

export default function Investors() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<InvestorRecord>(emptyForm);
  const [payoutFor, setPayoutFor] = useState<InvestorRecord | null>(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: investors, loading, error, refresh } = useAsync(
    (b) => b.listInvestors(),
    [db],
    [] as InvestorRecord[],
  );

  useEffect(() => db.subscribe("investors", refresh), [db, refresh]);

  const openNew = () => {
    setForm({ ...emptyForm, id: newId("inv") });
    setFormOpen(true);
  };
  const openEdit = (r: InvestorRecord) => {
    setForm({ ...r });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) return toast("Enter the investor's name", "rose");
    if (!form.agreementRef.trim()) return toast("Enter the agreement reference", "rose");
    if (!(form.sharePct > 0 && form.sharePct <= 100)) return toast("Share % must be 0–100", "rose");
    try {
      await db.upsertInvestor({ ...form, sharePct: Number(form.sharePct) }, actor);
      setFormOpen(false);
      refresh();
      toast("Investor record saved", "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save investor", "rose");
    }
  };

  const submitPayout = async () => {
    if (!payoutFor) return;
    const amount = Number(payoutAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid amount", "rose");
    try {
      await db.recordInvestorPayout(payoutFor.id, amount, actor);
      setPayoutFor(null);
      setPayoutAmount("");
      refresh();
      toast(`Payout of ${inr(amount)} recorded`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record payout", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Capital ledger"
          title="Investors"
          sub="Contractual investor arrangements and payout history. These are tracking records — never promises of returns."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load investors: {error}</p>}

        <div className="glass rounded-2xl p-5 mt-8 flex gap-4 items-start">
          <span className="text-2xl">⚖️</span>
          <p className="text-sm text-ivory-dim leading-relaxed">
            Investor entries record revenue-share agreements, schedules and actual payouts. Datevra
            does not guarantee investment returns; amounts shown are ledger history only.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={openNew} className="btn-gold rounded-xl px-5 py-3 text-sm">
            + Add investor
          </button>
        </div>

        <div className="glass rounded-3xl mt-4 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : investors.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No investor records" body="Add the first contractual arrangement to start the ledger." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr>
                    <th className={thCls}>Investor</th>
                    <th className={thCls}>Agreement</th>
                    <th className={thCls}>Share %</th>
                    <th className={thCls}>Schedule</th>
                    <th className={thCls}>Paid out</th>
                    <th className={thCls}>Pending</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {investors.map((r) => (
                    <tr key={r.id} className={rowCls}>
                      <td className={tdCls}>
                        <p className="text-ivory font-medium">{r.name}</p>
                        {r.notes && <p className="text-xs text-mist line-clamp-1">{r.notes}</p>}
                      </td>
                      <td className={`${tdCls} font-mono text-xs text-champagne whitespace-nowrap`}>
                        {r.agreementRef}
                      </td>
                      <td className={`${tdCls} text-ivory-dim`}>{r.sharePct}%</td>
                      <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{r.schedule}</td>
                      <td className={`${tdCls} text-emerald-300 whitespace-nowrap`}>{inr(r.paidOut)}</td>
                      <td className={`${tdCls} text-rosegold whitespace-nowrap`}>{inr(r.pending)}</td>
                      <td className={tdCls}>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setPayoutFor(r)}
                            className="text-xs text-champagne hover:text-rosegold"
                          >
                            Record payout
                          </button>
                          <button
                            onClick={() => openEdit(r)}
                            className="text-xs text-mist hover:text-ivory"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {formOpen && (
          <Modal open onClose={() => setFormOpen(false)} title={form.id && investors.some((i) => i.id === form.id) ? "Edit investor" : "Add investor"}>
            <div className="space-y-4">
              <Field label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Full legal name" />
              </Field>
              <Field label="Agreement reference">
                <input value={form.agreementRef} onChange={(e) => setForm({ ...form, agreementRef: e.target.value })} className={inputCls} placeholder="INV-2026-001" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Revenue share %">
                  <input value={String(form.sharePct)} onChange={(e) => setForm({ ...form, sharePct: Number(e.target.value) })} inputMode="decimal" className={inputCls} />
                </Field>
                <Field label="Schedule">
                  <input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className={inputCls} placeholder="Quarterly" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Paid out (₹)">
                  <input value={String(form.paidOut)} onChange={(e) => setForm({ ...form, paidOut: Number(e.target.value) })} inputMode="numeric" className={inputCls} />
                </Field>
                <Field label="Pending (₹)">
                  <input value={String(form.pending)} onChange={(e) => setForm({ ...form, pending: Number(e.target.value) })} inputMode="numeric" className={inputCls} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${inputCls} min-h-20`} placeholder="Contract terms summary…" />
              </Field>
              <button onClick={saveForm} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Save investor record
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payoutFor && (
          <Modal open onClose={() => setPayoutFor(null)} title={`Record payout — ${payoutFor.name}`}>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Pending before payout: <span className="text-rosegold font-medium">{inr(payoutFor.pending)}</span>
                <span className="text-mist"> · last updated {fmtDay(new Date().toISOString())}</span>
              </p>
              <Field label="Payout amount (₹)">
                <input value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} inputMode="numeric" className={inputCls} placeholder="50000" />
              </Field>
              <p className="text-xs text-mist">This is a ledger entry for a real transfer — never a promise of returns.</p>
              <button onClick={submitPayout} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Record payout
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
