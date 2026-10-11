import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { MEMBERSHIP_DISCLAIMER, PLANS } from "../../data/seed";
import {
  Badge,
  Modal,
  PlanBadge,
  Reveal,
  Skeleton,
  useToast,
} from "../../components/ui";
import { fmtDate, fmtExpiry, inr, timeAgo, useDbRefresh } from "./shared";
import type { Payment, PlanId, Subscription } from "../../lib/types";

const PAY_TONE: Record<Payment["status"], "gold" | "rose" | "muted" | "green"> = {
  pending: "gold",
  verified: "green",
  failed: "rose",
  refunded: "muted",
};

const PLAN_ACCENTS: Record<PlanId, string> = {
  connect: "from-celestial/20 via-transparent to-transparent",
  plus: "from-rosegold/20 via-transparent to-transparent",
  elite: "from-champagne/25 via-rosegold/10 to-transparent",
};

interface MembershipData {
  sub: Subscription | undefined;
  payments: Payment[];
  subs: Subscription[];
}

export default function Membership() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const tick = useDbRefresh("payments", "profiles");

  const [termsFor, setTermsFor] = useState<PlanId | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState<Payment | null>(null);
  const [verifying, setVerifying] = useState(false);

  const {
    data,
    loading,
    error,
    refresh: refreshData,
  } = useAsync(
    async (b): Promise<MembershipData | null> => {
      if (!user) return null;
      const [sub, payments, subs] = await Promise.all([
        b.activeSubscription(user.id),
        b.paymentsFor(user.id),
        b.subscriptionsFor(user.id),
      ]);
      return {
        sub,
        payments: payments.slice().reverse(),
        subs: subs.slice().reverse(),
      };
    },
    [user?.id, tick],
    null as MembershipData | null,
  );

  if (!user) return null;
  const me = user;

  const plan = data?.sub ? PLANS.find((p) => p.id === data.sub?.planId) : undefined;
  const termsPlan = termsFor ? PLANS.find((p) => p.id === termsFor) : undefined;

  const startCheckout = (planId: PlanId) => {
    setTermsFor(planId);
    setAgreed(false);
  };

  const confirmPurchase = async () => {
    if (!termsPlan || !agreed) return;
    try {
      const payment = await db.purchaseMembership(me.id, termsPlan.id, termsPlan.price);
      setPending(payment);
      setTermsFor(null);
      setAgreed(false);
      refreshData();
      toast("Order created. Complete the test payment to activate.", "gold");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Payments aren't available right now.",
        "rose",
      );
    }
  };

  const completeTestPayment = async () => {
    if (!pending) return;
    setVerifying(true);
    try {
      const result = await db.verifyPayment(pending.id, me.id);
      if (result && result.status === "verified") {
        const p = result.planId ? PLANS.find((x) => x.id === result.planId) : undefined;
        setPending(null);
        refresh();
        refreshData();
        toast(`Payment verified — welcome to ${p?.name ?? "your plan"}.`, "gold");
      } else {
        toast("Payment could not be verified. Please try again.", "rose");
      }
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Payment could not be verified.",
        "rose",
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="relative max-w-6xl mx-auto px-5 py-10">
      {/* dreamy ambience */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-burgundy/30 blur-[130px] animate-aura-shift" />
      <div className="pointer-events-none absolute top-64 -right-32 h-80 w-80 rounded-full bg-rosegold/10 blur-[120px]" />
      {[8, 26, 55, 74, 90].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-champagne/25 animate-twinkle"
          style={{ left: `${left}%`, top: `${40 + i * 90}px`, animationDelay: `${i * 0.7}s`, fontSize: `${9 + (i % 3) * 3}px` }}
        >
          ✦
        </span>
      ))}

      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Membership</p>
        <h1 className="font-display text-3xl md:text-4xl text-gradient-dream mt-1 mb-8">Choose how you're seen</h1>
      </Reveal>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-44 rounded-3xl" />
          <div className="grid md:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-96 rounded-3xl" />
            ))}
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load membership: {error}</p>
      ) : (
        <>
          {/* Current status */}
          <Reveal>
            <div className="glass-strong glow-border rounded-[2rem] p-6 md:p-8 mb-10 relative overflow-hidden">
              <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-burgundy/40 blur-[100px] animate-aura-shift" />
              <div className="relative flex flex-wrap items-center gap-6">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-[0.72rem] uppercase tracking-[0.24em] text-mist mb-2">Current plan</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <PlanBadge plan={data?.sub?.planId ?? null} />
                    {plan && <span className="text-ivory-dim text-sm italic">{plan.tagline}</span>}
                  </div>
                  {data?.sub ? (
                    <p className="text-sm text-mist mt-3">
                      Active {data.sub.expiresAt ? "until" : ""} <span className="text-champagne">{fmtExpiry(data.sub.expiresAt)}</span>
                      {" · "}
                      {data.sub.autoRenew ? "auto-renews monthly" : "auto-renew off"}
                    </p>
                  ) : (
                    <p className="text-sm text-mist mt-3">
                      You're on the Free plan — visible in discovery with standard matching.
                    </p>
                  )}
                </div>
                <div className="text-sm text-mist max-w-xs leading-relaxed">
                  {MEMBERSHIP_DISCLAIMER}
                </div>
              </div>
            </div>
          </Reveal>

          {/* Pending payment */}
          {pending && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-strong rounded-[2rem] p-6 mb-10 border border-champagne/40 shadow-[0_0_60px_rgba(197,164,255,0.12)]"
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-display text-xl text-ivory">Payment pending</p>
                  <p className="text-sm text-mist mt-1">
                    {inr(pending.amount)} · Order <span className="text-champagne">{pending.razorpayOrderId}</span> ·
                    Razorpay test mode
                  </p>
                  <p className="text-xs text-mist/80 mt-1">
                    Your plan activates only after the payment is verified. Nothing is marked successful before then.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setPending(null)} className="btn-ghost rounded-full px-5 py-2.5 text-sm">
                    Dismiss
                  </button>
                  <button
                    onClick={completeTestPayment}
                    disabled={verifying}
                    className="btn-gold rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-60"
                  >
                    {verifying ? "Verifying…" : "Complete test payment"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Plans */}
          <div className="grid md:grid-cols-3 gap-5 mb-12 items-stretch">
            {PLANS.map((p, i) => {
              const isCurrent = data?.sub?.planId === p.id;
              const featured = p.id === "elite";
              const action = isCurrent
                ? "Current plan"
                : data?.sub
                  ? p.price > (plan?.price ?? 0) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`
                  : `Choose ${p.name}`;
              return (
                <Reveal key={p.id} delay={i * 0.08} className="h-full">
                  <motion.div
                    whileHover={{ y: -8 }}
                    transition={{ type: "spring", stiffness: 240, damping: 22 }}
                    className={`relative rounded-[2rem] p-7 h-full overflow-hidden flex flex-col ${
                      featured
                        ? "glass-strong glow-border animate-glow-pulse"
                        : "glass border border-white/10 card-hover"
                    } ${isCurrent ? "ring-1 ring-rosegold/60" : ""}`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-b pointer-events-none ${PLAN_ACCENTS[p.id]}`} />
                    {featured && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                        <Badge tone="gold">✦ Most coveted</Badge>
                      </div>
                    )}
                    <div className="relative flex-1 flex flex-col">
                      <p className="text-[0.68rem] uppercase tracking-[0.28em] text-rosegold">
                        {featured ? "Signature" : p.id === "plus" ? "Most loved" : "Begin"}
                      </p>
                      <p className="font-display text-3xl text-gradient-gold mt-1">{p.name}</p>
                      <p className="text-sm text-mist mt-1 italic">{p.tagline}</p>
                      <p className="mt-4">
                        <span className="font-display text-4xl text-gradient-gold font-semibold">{inr(p.price)}</span>
                        <span className="text-sm text-mist"> /month</span>
                      </p>
                      <div className="ornament-divider my-6 max-w-[9rem]">
                        <span className="text-sm">✦</span>
                      </div>
                      <ul className="space-y-2.5 flex-1">
                        {p.features.map((f) => (
                          <li key={f} className="text-sm text-ivory-dim flex gap-2">
                            <span className="text-rosegold shrink-0">✦</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => startCheckout(p.id)}
                        disabled={isCurrent}
                        className={`w-full mt-7 rounded-full py-3 text-sm font-medium transition-all ${
                          isCurrent
                            ? "btn-ghost opacity-60 cursor-default"
                            : featured
                              ? "btn-gold"
                              : "btn-ghost hover:text-ivory"
                        }`}
                      >
                        {action}
                      </button>
                    </div>
                  </motion.div>
                </Reveal>
              );
            })}
          </div>

          {/* History */}
          <div className="grid lg:grid-cols-2 gap-6">
            <Reveal>
              <div className="glass rounded-[2rem] p-6 relative overflow-hidden">
                <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-champagne/10 blur-[80px]" />
                <h2 className="font-display text-xl text-ivory mb-4 relative">Purchase history</h2>
                {(data?.payments.length ?? 0) === 0 ? (
                  <p className="text-sm text-mist relative">No payments yet.</p>
                ) : (
                  <div className="space-y-3 relative">
                    {data?.payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 hairline pb-3 last:border-0 last:pb-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-ivory text-sm font-medium">
                            {p.planId ? PLANS.find((x) => x.id === p.planId)?.name : "Payment"} · {inr(p.amount)}
                          </p>
                          <p className="text-xs text-mist">
                            {timeAgo(p.createdAt)} · {p.method}
                          </p>
                        </div>
                        <Badge tone={PAY_TONE[p.status]}>{p.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="glass rounded-[2rem] p-6 relative overflow-hidden">
                <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-rosegold/10 blur-[80px]" />
                <h2 className="font-display text-xl text-ivory mb-4 relative">Subscription history</h2>
                {(data?.subs.length ?? 0) === 0 ? (
                  <p className="text-sm text-mist relative">No subscriptions yet.</p>
                ) : (
                  <div className="space-y-3 relative">
                    {data?.subs.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 hairline pb-3 last:border-0 last:pb-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-ivory text-sm font-medium">
                            {PLANS.find((x) => x.id === s.planId)?.name}
                          </p>
                          <p className="text-xs text-mist">
                            {fmtDate(s.startedAt)} → {fmtExpiry(s.expiresAt)}
                            {s.autoRenew ? " · auto-renew" : ""}
                          </p>
                        </div>
                        <Badge tone={s.status === "active" ? "green" : "muted"}>{s.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          </div>

          <p className="text-xs text-mist/80 mt-10 max-w-3xl leading-relaxed">
            {MEMBERSHIP_DISCLAIMER} Payments are processed in Razorpay test mode until live credentials are configured.
          </p>
        </>
      )}

      {/* Terms popup — consent gate before any payment action */}
      <Modal open={!!termsFor} onClose={() => setTermsFor(null)} title={termsPlan ? `${termsPlan.name} · ${inr(termsPlan.price)}/month` : ""}>
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4 border border-champagne/20">
            <p className="text-[0.72rem] uppercase tracking-[0.2em] text-rosegold mb-2">Please read</p>
            <p className="text-sm text-ivory-dim leading-relaxed">{MEMBERSHIP_DISCLAIMER}</p>
            <p className="text-sm text-ivory-dim leading-relaxed mt-2">
              Payment does not guarantee romantic commitment, matches, curated date selection, or any
              particular outcome. Billing is monthly and renews automatically until cancelled.
            </p>
          </div>
          <ul className="space-y-2">
            {(termsPlan?.features ?? []).map((f) => (
              <li key={f} className="text-sm text-ivory-dim flex gap-2">
                <span className="text-rosegold">✦</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-3 cursor-pointer glass rounded-2xl p-4">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#FF3D9A]"
            />
            <span className="text-sm text-ivory-dim">
              I understand that membership enhances visibility and priority only, and does not
              guarantee matches, dates, or any romantic outcome.
            </span>
          </label>
          <div className="flex justify-end gap-3">
            <button onClick={() => setTermsFor(null)} className="btn-ghost rounded-full px-5 py-2.5 text-sm">
              Cancel
            </button>
            <button
              onClick={confirmPurchase}
              disabled={!agreed}
              className="btn-gold rounded-full px-6 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              Agree & continue to payment
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
