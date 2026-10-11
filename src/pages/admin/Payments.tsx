import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { Payment, PaymentStatus, UserProfile } from "../../lib/types";
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

const STATUS_TONES: Record<PaymentStatus, "gold" | "green" | "rose" | "muted"> = {
  pending: "gold",
  verified: "green",
  failed: "rose",
  refunded: "muted",
};

export default function Payments() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [statusFilter, setStatusFilter] = useState("all");
  const [cashOpen, setCashOpen] = useState(false);
  const [cashEmail, setCashEmail] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cashNote, setCashNote] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: paymentsRaw, loading, error, refresh: refreshPayments } = useAsync(
    (b) => b.allPayments(),
    [db],
    [] as Payment[],
  );
  const { data: all } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => db.subscribe("payments", refreshPayments), [db, refreshPayments]);

  const userMap = useMemo(() => new Map(all.map((u) => [u.id, u])), [all]);

  const payments = paymentsRaw.filter((p) => statusFilter === "all" || p.status === statusFilter);

  const onVerify = async (p: Payment) => {
    try {
      const res = await db.verifyPayment(p.id, actor);
      refreshPayments();
      if (res && res.status === "verified") toast(`Payment ${p.id} verified`, "gold");
      else toast("Payment could not be verified", "rose");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verification failed", "rose");
    }
  };

  const onRefund = async (p: Payment) => {
    if (!window.confirm(`Refund ₹${p.amount} for payment ${p.id}? This record is kept, never deleted.`))
      return;
    try {
      await db.refundPayment(p.id, actor);
      refreshPayments();
      toast("Refund recorded", "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Refund failed", "rose");
    }
  };

  const submitCash = async () => {
    const u = all.find((x) => x.email.toLowerCase() === cashEmail.trim().toLowerCase());
    const amount = Number(cashAmount);
    if (!u) return toast("No member with that email", "rose");
    if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid amount", "rose");
    try {
      await db.recordCashPayment(u.id, amount, cashNote.trim() || "counter payment", actor);
      setCashOpen(false);
      setCashEmail("");
      setCashAmount("");
      setCashNote("");
      refreshPayments();
      toast(`Cash payment of ₹${amount} recorded for ${u.firstName}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record payment", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Money movement"
          title="Payments"
          sub="Verify online payments, record cash at the counter, and issue refunds. History is never silently altered."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load payments: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputCls} sm:max-w-xs`}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="refunded">Refunded</option>
            <option value="failed">Failed</option>
          </select>
          <span className="text-sm text-mist">{payments.length} payments</span>
          <button onClick={() => setCashOpen(true)} className="btn-gold rounded-xl px-5 py-3 text-sm sm:ml-auto">
            + Record cash payment
          </button>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No payments" body="Transactions will appear here once members check out." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr>
                    <th className={thCls}>ID</th>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Kind</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Method</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Created</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const u = userMap.get(p.userId);
                    return (
                      <tr key={p.id} className={rowCls}>
                        <td className={`${tdCls} font-mono text-xs text-mist whitespace-nowrap`}>{p.id}</td>
                        <td className={tdCls}>
                          <p className="text-ivory whitespace-nowrap">{u?.firstName ?? "—"}</p>
                          <p className="text-xs text-mist">{u?.email}</p>
                        </td>
                        <td className={`${tdCls} text-ivory-dim capitalize`}>{p.kind}</td>
                        <td className={`${tdCls} text-champagne font-medium whitespace-nowrap`}>{inr(p.amount)}</td>
                        <td className={`${tdCls} text-ivory-dim max-w-[160px]`}>
                          <p className="line-clamp-1">{p.method}</p>
                        </td>
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[p.status]}>{p.status}</Badge>
                        </td>
                        <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(p.createdAt)}</td>
                        <td className={tdCls}>
                          <div className="flex gap-2 flex-wrap">
                            {p.status === "pending" && (
                              <button
                                onClick={() => onVerify(p)}
                                className="text-xs text-emerald-300 hover:text-emerald-200"
                              >
                                Verify
                              </button>
                            )}
                            {p.status === "verified" && (
                              <button
                                onClick={() => onRefund(p)}
                                className="text-xs text-rosegold hover:text-champagne"
                              >
                                Refund
                              </button>
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
        {cashOpen && (
          <Modal open onClose={() => setCashOpen(false)} title="Record cash payment">
            <div className="space-y-4">
              <Field label="Member email" hint="The payment is credited to this member's account.">
                <input
                  value={cashEmail}
                  onChange={(e) => setCashEmail(e.target.value)}
                  placeholder="member@example.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Amount (₹)">
                <input
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="1200"
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>
              <Field label="Note" hint="Counter receipt, purpose, reference.">
                <input
                  value={cashNote}
                  onChange={(e) => setCashNote(e.target.value)}
                  placeholder="Experience fee — cash at venue"
                  className={inputCls}
                />
              </Field>
              <button onClick={submitCash} className="btn-gold rounded-xl px-6 py-3 text-sm w-full">
                Record payment
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
