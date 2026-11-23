import { useEffect, useState } from "react";
import type {
  ComplimentaryPass,
  UserVoucher,
  VoucherOtpChallengeResponse,
  VoucherSettings,
} from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { isMemberEligibleForOutsideDelhiVoucher } from "../../lib/voucherPolicy";
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
import { fmtDate } from "../admin/_util";

const VOUCHER_TONE: Record<UserVoucher["status"], "gold" | "green" | "muted" | "rose"> = {
  issued: "gold",
  redeemed: "green",
  expired: "muted",
  revoked: "rose",
};

export default function MyPasses() {
  const { session, user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const userId = session?.userId ?? "";
  const [code, setCode] = useState("");

  // Outside-Delhi Voucher OTP state
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState<VoucherOtpChallengeResponse | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [redeemingVoucherId, setRedeemingVoucherId] = useState<string | null>(null);

  const { data: passes, loading, error, refresh } = useAsync(
    (b) => b.myComplimentaryPasses(userId),
    [db, userId],
    [] as ComplimentaryPass[],
  );

  const { data: voucherSettings, refresh: refreshSettings } = useAsync(
    (b) => b.getVoucherSettings().catch(() => null),
    [db],
    null as VoucherSettings | null,
  );

  const { data: vouchers, refresh: refreshVouchers } = useAsync(
    (b) => (userId ? b.myVouchers(userId).catch(() => []) : Promise.resolve([])),
    [db, userId],
    [] as UserVoucher[],
  );

  useEffect(() => {
    const u1 = db.subscribe("passes", refresh);
    const u2 = db.subscribe("vouchers", () => {
      refreshSettings();
      refreshVouchers();
    });
    return () => {
      u1();
      u2();
    };
  }, [db, refresh, refreshSettings, refreshVouchers]);

  const redeem = async () => {
    if (!code.trim()) {
      toast("Enter a pass code", "rose");
      return;
    }
    try {
      const pass = await db.redeemComplimentaryPass(code, userId);
      toast(`Pass redeemed at ${pass.cafeName}`, "gold");
      setCode("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not redeem", "rose");
    }
  };

  const eligibility = (() => {
    if (!user || !voucherSettings) {
      return { eligible: false, reason: "Checking voucher program status…" };
    }
    if (!voucherSettings.enabled || !voucherSettings.voucherValueInr || voucherSettings.voucherValueInr <= 0) {
      return {
        eligible: false,
        reason: "The Outside-Delhi voucher program is currently paused or awaiting an approved voucher value.",
      };
    }
    const priorClaims = vouchers.filter((v) => v.status !== "revoked").length;
    if (priorClaims >= voucherSettings.maxClaimsPerUser) {
      return {
        eligible: false,
        reason: "You have already claimed your Outside-Delhi welcome voucher.",
      };
    }
    return isMemberEligibleForOutsideDelhiVoucher(
      user.city,
      user.registeredCity ?? user.city,
      voucherSettings.excludedCities,
    );
  })();

  const requestOtp = async () => {
    if (!userId) return;
    if (channel === "sms" && !phone.trim()) {
      toast("Enter your mobile number for SMS OTP verification.", "rose");
      return;
    }
    setOtpBusy(true);
    try {
      const res = await db.requestVoucherOtp(userId, channel, channel === "sms" ? phone.trim() : undefined);
      setChallenge(res);
      setOtpInput("");
      toast(`Verification code sent to ${res.destinationMasked}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send verification OTP", "rose");
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtpAndClaim = async () => {
    if (!userId || !challenge) return;
    if (!/^\d{6}$/.test(otpInput.trim())) {
      toast("Enter the 6-digit verification code.", "rose");
      return;
    }
    setOtpBusy(true);
    try {
      const issued = await db.verifyVoucherOtpAndClaim(userId, challenge.challengeId, otpInput.trim());
      toast(`Voucher ${issued.code} (₹${issued.valueInr}) issued to your account!`, "gold");
      setOtpModalOpen(false);
      setChallenge(null);
      setOtpInput("");
      refreshVouchers();
    } catch (e) {
      toast(e instanceof Error ? e.message : "OTP verification failed", "rose");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleRedeemVoucher = async (v: UserVoucher) => {
    setRedeemingVoucherId(v.id);
    try {
      const updated = await db.redeemVoucher(v.code, userId, "member-redemption");
      toast(`Voucher ${updated.code} redeemed (₹${updated.valueInr}).`, "gold");
      refreshVouchers();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not redeem voucher", "rose");
    } finally {
      setRedeemingVoucherId(null);
    }
  };

  const active = passes.filter((p) => p.status === "active");
  const history = passes.filter((p) => p.status !== "active");

  return (
    <div className="px-0 sm:px-4 pb-10 sm:pb-24 pt-2 sm:pt-10 max-w-3xl mx-auto">
      <SectionHead
        kicker="Passes & vouchers"
        title="My passes & vouchers"
        sub="Redeem complimentary venue passes or claim your OTP-verified Outside-Delhi welcome voucher."
        align="left"
      />

      {/* Outside-Delhi Limited-Value Money Voucher (Requirement 8) */}
      <div className="glass-strong rounded-3xl border border-champagne/25 p-5 sm:p-6 mt-6 mb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] uppercase tracking-[0.24em] text-champagne">
              Outside-Delhi Welcome Voucher
            </p>
            <h3 className="font-display text-2xl text-ivory mt-1">
              {voucherSettings?.enabled && voucherSettings.voucherValueInr
                ? `₹${voucherSettings.voucherValueInr.toLocaleString("en-IN")} Limited-Value Voucher`
                : "Outside-Delhi Money Voucher"}
            </h3>
            <p className="text-sm text-ivory-dim/90 mt-1.5 leading-relaxed">
              Exclusively for verified members registered outside Delhi. Requires one-time server OTP verification before issuance.
            </p>
            {user && (
              <p className="text-xs text-mist mt-2">
                Registered city: <span className="text-ivory">{user.registeredCity || user.city || "Not set"}</span>
                {user.city && user.registeredCity && user.city !== user.registeredCity && (
                  <span> · Current city: {user.city}</span>
                )}
              </p>
            )}
          </div>
          <div>
            {eligibility.eligible ? (
              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setOtpInput("");
                  setOtpModalOpen(true);
                }}
                className="btn-gold rounded-full px-5 py-2.5 min-h-[44px] text-sm font-semibold whitespace-nowrap"
              >
                Verify OTP & Claim
              </button>
            ) : (
              <Badge tone={vouchers.length > 0 ? "green" : "muted"}>
                {vouchers.length > 0 ? "Claimed" : "Not eligible"}
              </Badge>
            )}
          </div>
        </div>

        {!eligibility.eligible && eligibility.reason && vouchers.length === 0 && (
          <p className="text-xs text-mist mt-3 bg-white/[0.03] border border-white/10 rounded-xl px-3.5 py-2.5">
            {eligibility.reason}
          </p>
        )}

        {vouchers.length > 0 && (
          <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
            <p className="text-xs uppercase tracking-[0.22em] text-mist">Your issued vouchers</p>
            {vouchers.map((v) => (
              <div
                key={v.id}
                className="rounded-2xl border border-champagne/30 p-4 bg-gradient-to-br from-champagne/10 to-transparent flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg text-champagne font-semibold tracking-wider break-all">
                      {v.code}
                    </span>
                    <Badge tone={VOUCHER_TONE[v.status]}>{v.status}</Badge>
                  </div>
                  <p className="text-sm text-ivory mt-1">
                    Value: <span className="text-champagne font-semibold">₹{v.valueInr.toLocaleString("en-IN")}</span>
                    {" · "}OTP verified {fmtDate(v.otpVerifiedAt)}
                  </p>
                  <p className="text-xs text-mist mt-0.5">
                    City: {v.cityAtClaim} · Expires {fmtDate(v.expiresAt)}
                  </p>
                </div>
                {v.status === "issued" && (
                  <button
                    type="button"
                    disabled={redeemingVoucherId === v.id}
                    onClick={() => handleRedeemVoucher(v)}
                    className="btn-gold rounded-full px-5 py-2 min-h-[44px] text-sm font-medium shrink-0"
                  >
                    {redeemingVoucherId === v.id ? "Redeeming…" : "Redeem voucher"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Complimentary Venue Passes (Preserved) */}
      <div className="rounded-2xl border border-white/10 p-4 sm:p-5 bg-white/[0.02]">
        <Field label="Have a complimentary venue pass code?">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={`${inputCls} min-w-0 flex-1 font-mono uppercase`}
              placeholder="DVR-XXXXXX"
              maxLength={10}
            />
            <button
              onClick={redeem}
              className="btn-gold rounded-full px-6 min-h-[44px] text-sm font-medium whitespace-nowrap shrink-0"
            >
              Redeem
            </button>
          </div>
        </Field>
      </div>

      {loading ? (
        <Skeleton className="mt-6 h-32" />
      ) : error ? (
        <EmptyState title="Could not load passes" body={error} />
      ) : (
        <>
          <h3 className="text-lg font-semibold mt-8 mb-3">Active complimentary passes ({active.length})</h3>
          {active.length === 0 ? (
            <p className="text-white/40 text-sm">No active complimentary passes right now.</p>
          ) : (
            <div className="grid gap-3">
              {active.map((p) => (
                <div
                  key={p.id}
                  className="rounded-2xl border border-champagne/30 p-4 sm:p-5 bg-gradient-to-br from-champagne/10 to-transparent"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-lg">{p.cafeName}</p>
                      {p.note && <p className="text-sm text-white/60 mt-1">{p.note}</p>}
                      {p.expiresAt && <p className="text-xs text-white/40 mt-1">Expires {fmtDate(p.expiresAt)}</p>}
                    </div>
                    <Badge tone="gold">Active</Badge>
                  </div>
                  <p className="font-mono text-xl sm:text-2xl text-champagne mt-3 tracking-wider sm:tracking-widest break-all">
                    {p.code}
                  </p>
                  <p className="text-xs text-white/40 mt-1">Show this code at the venue</p>
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <>
              <h3 className="text-lg font-semibold mt-8 mb-3 text-white/60">Pass history</h3>
              <div className="grid gap-2">
                {history.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-white/5 p-4 flex flex-wrap justify-between items-center gap-2 opacity-60"
                  >
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

      {/* OTP Verification Modal */}
      <Modal
        open={otpModalOpen}
        onClose={() => {
          if (!otpBusy) setOtpModalOpen(false);
        }}
        title="Verify OTP to Claim Voucher"
      >
        <div className="space-y-4">
          <p className="text-sm text-ivory-dim leading-relaxed">
            To prevent abuse, Outside-Delhi limited-value vouchers are issued only after verifying a one-time code sent to your email or phone.
          </p>

          {!challenge ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {(["email", "sms"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`rounded-xl py-2.5 px-3 text-sm border transition-all min-h-[44px] ${
                      channel === ch
                        ? "border-champagne bg-champagne/15 text-champagne font-medium"
                        : "border-white/10 text-ivory-dim hover:bg-white/5"
                    }`}
                  >
                    {ch === "email" ? "Email OTP" : "SMS OTP"}
                  </button>
                ))}
              </div>

              {channel === "sms" && (
                <Field label="Mobile number (with country code)" hint="Example: +919876543210">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91XXXXXXXXXX"
                    className={inputCls}
                  />
                </Field>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={otpBusy}
                  onClick={() => setOtpModalOpen(false)}
                  className="btn-ghost rounded-full px-5 py-2.5 min-h-[44px] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={otpBusy}
                  onClick={requestOtp}
                  className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm font-medium"
                >
                  {otpBusy ? "Sending…" : "Send 6-digit OTP"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-white/5 border border-champagne/25 p-3.5 text-xs text-ivory-dim">
                Code sent via <span className="text-champagne uppercase">{challenge.channel}</span> to{" "}
                <span className="text-ivory font-medium">{challenge.destinationMasked}</span>. Expires at{" "}
                {fmtDate(challenge.expiresAt)}.
              </div>

              <Field label="Enter 6-digit OTP">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className={`${inputCls} font-mono tracking-[0.35em] text-center`}
                />
              </Field>

              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <button
                  type="button"
                  disabled={otpBusy}
                  onClick={() => {
                    setChallenge(null);
                    setOtpInput("");
                  }}
                  className="btn-ghost rounded-full px-4 py-2.5 min-h-[44px] text-sm"
                >
                  Change channel
                </button>
                <button
                  type="button"
                  disabled={otpBusy || otpInput.length !== 6}
                  onClick={verifyOtpAndClaim}
                  className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm font-medium disabled:opacity-50"
                >
                  {otpBusy ? "Verifying…" : "Verify & Claim"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

