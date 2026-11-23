import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Save, ShieldCheck, Ticket } from "lucide-react";
import type {
  UserProfile,
  UserVoucher,
  VoucherOtpStatusRecord,
  VoucherSettings,
} from "../../lib/types";
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
import { MigrationAlertBanner } from "../../components/MigrationAlertBanner";
import {
  DEFAULT_EXCLUDED_VOUCHER_CITIES,
  isMemberEligibleForOutsideDelhiVoucher,
} from "../../lib/voucherPolicy";
import { fmtDate, fmtDay, rowCls, tdCls, thCls } from "./_util";

type SubTab = "vouchers" | "eligible" | "otp";

const STATUS_TONE: Record<string, "gold" | "green" | "rose" | "muted"> = {
  issued: "gold",
  redeemed: "green",
  revoked: "rose",
  expired: "muted",
  pending: "gold",
  verified: "green",
  consumed: "green",
  locked: "rose",
};

const DEFAULT_SETTINGS: VoucherSettings = {
  enabled: false,
  voucherValueInr: null,
  maxClaimsPerUser: 1,
  maxTotalVouchers: null,
  expiryDays: 30,
  excludedCities: [...DEFAULT_EXCLUDED_VOUCHER_CITIES],
  ncrPolicyNote:
    "Excludes NCT of Delhi (Delhi, New Delhi). Delhi-NCR cities (Noida, Gurugram, Faridabad, Ghaziabad) are treated as outside-Delhi unless explicitly added to excluded cities.",
  usageRules:
    "Limited-value, non-cash-withdrawable Datevra credit. Single-use only.",
};

export default function AdminVouchers() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  const [subTab, setSubTab] = useState<SubTab>("vouchers");
  const [saving, setSaving] = useState(false);

  // Settings form state
  const [enabled, setEnabled] = useState(false);
  const [valueInput, setValueInput] = useState("");
  const [maxPerUser, setMaxPerUser] = useState("1");
  const [maxTotal, setMaxTotal] = useState("");
  const [expiryDays, setExpiryDays] = useState("30");
  const [excludedCitiesText, setExcludedCitiesText] = useState("delhi, new delhi");
  const [usageRules, setUsageRules] = useState(DEFAULT_SETTINGS.usageRules);

  // Revoke modal
  const [revokeTarget, setRevokeTarget] = useState<UserVoucher | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const {
    data: settings,
    refresh: refreshSettings,
  } = useAsync((b) => b.getVoucherSettings(), [db], DEFAULT_SETTINGS);

  const {
    data: vouchers,
    loading,
    error,
    refresh: refreshVouchers,
  } = useAsync((b) => b.listAllVouchers(), [db], [] as UserVoucher[]);

  const { data: otpLogs, refresh: refreshOtp } = useAsync(
    (b) => b.listVoucherOtpStatus(),
    [db],
    [] as VoucherOtpStatusRecord[],
  );

  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => {
    setEnabled(settings.enabled);
    setValueInput(settings.voucherValueInr !== null ? String(settings.voucherValueInr) : "");
    setMaxPerUser(String(settings.maxClaimsPerUser));
    setMaxTotal(settings.maxTotalVouchers !== null ? String(settings.maxTotalVouchers) : "");
    setExpiryDays(String(settings.expiryDays));
    setExcludedCitiesText(settings.excludedCities.join(", "));
    setUsageRules(settings.usageRules);
  }, [settings]);

  const refreshAll = () => {
    refreshSettings();
    refreshVouchers();
    refreshOtp();
  };

  useEffect(() => db.subscribe("vouchers", refreshAll), [db]);

  const eligibleMembers = useMemo(
    () =>
      users.filter((u) => {
        if (u.isAdmin || u.id === "admin-1") return false;
        return isMemberEligibleForOutsideDelhiVoucher(
          u.city,
          u.registeredCity ?? u.city,
          settings.excludedCities,
        ).eligible;
      }),
    [users, settings.excludedCities],
  );

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const handleSaveSettings = async () => {
    const parsedVal = valueInput.trim() ? parseInt(valueInput.trim(), 10) : null;
    if (enabled && (!parsedVal || isNaN(parsedVal) || parsedVal <= 0)) {
      toast("Configure an approved positive INR voucher value before enabling issuance.", "rose");
      return;
    }
    const excludedCities = excludedCitiesText
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    setSaving(true);
    try {
      await db.updateVoucherSettings(
        {
          enabled,
          voucherValueInr: parsedVal,
          maxClaimsPerUser: Math.max(1, parseInt(maxPerUser, 10) || 1),
          maxTotalVouchers: maxTotal.trim() ? Math.max(1, parseInt(maxTotal.trim(), 10)) : null,
          expiryDays: Math.max(1, parseInt(expiryDays, 10) || 30),
          excludedCities: excludedCities.length > 0 ? excludedCities : ["delhi", "new delhi"],
          usageRules: usageRules.trim() || DEFAULT_SETTINGS.usageRules,
        },
        actor,
      );
      toast("Outside-Delhi voucher configuration saved.", "gold");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "rose");
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await db.revokeVoucher(revokeTarget.id, revokeReason.trim() || null, actor);
      toast(`Revoked voucher ${revokeTarget.code}`, "gold");
      setRevokeTarget(null);
      setRevokeReason("");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke voucher", "rose");
    }
  };

  return (
    <div className="px-0 sm:px-4 pb-16 sm:pb-24 pt-2 sm:pt-6 max-w-7xl mx-auto space-y-6">
      <SectionHead
        align="left"
        kicker="Regional Rewards & OTP Verification"
        title="Outside-Delhi Money Vouchers"
        sub="Configure limited-value, non-cash-withdrawable vouchers for eligible members registered outside Delhi. Issuance remains disabled until an administrator sets an approved INR value."
      />

      {error?.includes("MIGRATION_REQUIRED") && (
        <MigrationAlertBanner
          migrationId="032"
          migrationFile="db/migrations/032_outside_delhi_vouchers_and_otp.sql"
          featureName="Outside-Delhi Vouchers & OTP"
          description="Execute Migration 032 in Supabase to install voucher_settings, user_vouchers, anti-spoofing city history, and datevra_internal.voucher_otp_challenges."
          onRefresh={refreshAll}
        />
      )}

      {/* Configuration Card */}
      <div className="glass glow-border rounded-3xl p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ivory">Program Configuration</h2>
            <p className="text-xs text-mist mt-0.5">{settings.ncrPolicyNote}</p>
          </div>
          <Badge tone={settings.enabled ? "green" : "muted"}>
            {settings.enabled ? `Active · ₹${settings.voucherValueInr}` : "Disabled by Default"}
          </Badge>
        </div>

        {!settings.voucherValueInr && (
          <div className="rounded-2xl border border-champagne/30 bg-champagne/10 p-3.5 flex items-start gap-2.5 text-xs text-champagne">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              No approved monetary voucher value is configured yet. Voucher claiming stays blocked until an administrator enters an approved positive INR value and enables issuance.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Approved Value (INR)" hint="Non-cash-withdrawable credit">
            <input
              type="number"
              min="1"
              max="50000"
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              placeholder="Unset (e.g. 250)"
              className={inputCls}
            />
          </Field>
          <Field label="Expiry Window (Days)">
            <input
              type="number"
              min="1"
              max="365"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Max Claims / Member">
            <input
              type="number"
              min="1"
              max="5"
              value={maxPerUser}
              onChange={(e) => setMaxPerUser(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Global Cap (Optional)">
            <input
              type="number"
              min="1"
              value={maxTotal}
              onChange={(e) => setMaxTotal(e.target.value)}
              placeholder="Unlimited"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Field
            label="Excluded Cities (Comma-separated)"
            hint="Default excludes NCT of Delhi ('delhi, new delhi'). Add NCR cities explicitly if desired."
          >
            <input
              type="text"
              value={excludedCitiesText}
              onChange={(e) => setExcludedCitiesText(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Usage Rules">
            <input
              type="text"
              value={usageRules}
              onChange={(e) => setUsageRules(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-white/10">
          <label className="inline-flex items-center gap-2.5 text-sm text-ivory cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-champagne w-4 h-4"
            />
            <span>Enable Outside-Delhi Voucher Issuance (requires OTP verification)</span>
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={handleSaveSettings}
            className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm font-semibold inline-flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save Policy"}
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Eligible Outside-Delhi", val: eligibleMembers.length, tone: "text-champagne" },
          { label: "Issued (Active)", val: vouchers.filter((v) => v.status === "issued").length, tone: "text-ivory" },
          { label: "Redeemed", val: vouchers.filter((v) => v.status === "redeemed").length, tone: "text-emerald-400" },
          { label: "Revoked / Expired", val: vouchers.filter((v) => v.status === "revoked" || v.status === "expired").length, tone: "text-rosegold" },
        ].map((m) => (
          <div key={m.label} className="glass rounded-2xl p-4">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist">{m.label}</p>
            <p className={`font-display text-2xl mt-1 ${m.tone}`}>{m.val}</p>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["vouchers", `Issued & Redeemed Vouchers (${vouchers.length})`],
            ["eligible", `Eligible Members (${eligibleMembers.length})`],
            ["otp", `OTP Verification Status (${otpLogs.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k)}
            className={`px-4 py-2 rounded-full text-xs font-medium min-h-[40px] transition-all ${
              subTab === k ? "bg-champagne text-ink" : "bg-white/5 text-ivory-dim hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "vouchers" &&
        (loading ? (
          <Skeleton />
        ) : vouchers.length === 0 ? (
          <EmptyState
            title="No vouchers issued yet"
            body="Once enabled with an approved INR value, eligible outside-Delhi members can verify via OTP and claim a voucher."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 glass">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02]">
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Member</th>
                  <th className={thCls}>City (Registered / Claim)</th>
                  <th className={thCls}>Value</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Expires</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id} className={rowCls}>
                    <td className={tdCls}>
                      <span className="font-mono text-champagne font-semibold">{v.code}</span>
                    </td>
                    <td className={tdCls}>
                      <p className="text-ivory font-medium">{v.userName ?? userMap.get(v.userId)?.firstName ?? v.userId.slice(0, 8)}</p>
                      {v.userEmail && <p className="text-xs text-mist">{v.userEmail}</p>}
                    </td>
                    <td className={tdCls}>
                      <span className="text-xs text-ivory-dim">
                        {v.registeredCityAtClaim} / {v.cityAtClaim}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className="text-champagne font-medium">₹{v.valueInr}</span>
                    </td>
                    <td className={tdCls}>
                      <Badge tone={STATUS_TONE[v.status] ?? "muted"}>{v.status}</Badge>
                    </td>
                    <td className={tdCls}>
                      <span className="text-xs text-mist">{fmtDay(v.expiresAt)}</span>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      {v.status === "issued" ? (
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(v)}
                          className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-500/10"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-mist">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {subTab === "eligible" && (
        <div className="overflow-x-auto rounded-2xl border border-white/10 glass">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className={thCls}>Member</th>
                <th className={thCls}>Registered City</th>
                <th className={thCls}>Current City</th>
                <th className={thCls}>Claimed Vouchers</th>
              </tr>
            </thead>
            <tbody>
              {eligibleMembers.map((m) => {
                const count = vouchers.filter((v) => v.userId === m.id && v.status !== "revoked").length;
                return (
                  <tr key={m.id} className={rowCls}>
                    <td className={tdCls}>
                      <p className="text-ivory font-medium">{m.firstName}</p>
                      <p className="text-xs text-mist">{m.email}</p>
                    </td>
                    <td className={tdCls}>{m.registeredCity ?? m.city}</td>
                    <td className={tdCls}>{m.city}</td>
                    <td className={tdCls}>
                      <Badge tone={count > 0 ? "green" : "gold"}>{count} claimed</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "otp" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-mist">
            <ShieldCheck className="w-4 h-4 text-champagne" />
            <span>OTP secrets and hashes are never exposed in admin views. Showing masked verification audit records only.</span>
          </div>
          {otpLogs.length === 0 ? (
            <EmptyState title="No OTP verification attempts yet" body="OTP audit records appear here when eligible members verify to claim a voucher." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 glass">
              <table className="w-full min-w-[740px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Channel / Destination</th>
                    <th className={thCls}>Attempts</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {otpLogs.map((o) => (
                    <tr key={o.id} className={rowCls}>
                      <td className={tdCls}>{userMap.get(o.userId)?.firstName ?? o.userId.slice(0, 8)}</td>
                      <td className={tdCls}>
                        <span className="uppercase text-xs text-champagne mr-2">{o.channel}</span>
                        <span className="font-mono text-xs text-ivory-dim">{o.destinationMasked}</span>
                      </td>
                      <td className={tdCls}>{o.attemptCount} / {o.maxAttempts}</td>
                      <td className={tdCls}>
                        <Badge tone={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge>
                      </td>
                      <td className={tdCls}>
                        <span className="text-xs text-mist">{fmtDate(o.createdAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)} title="Revoke Voucher">
        {revokeTarget && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-ivory">
              <Ticket className="w-4 h-4 text-champagne" />
              <span className="font-mono text-champagne">{revokeTarget.code}</span>
              <span>(₹{revokeTarget.valueInr})</span>
            </div>
            <Field label="Revocation Reason (Optional)">
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Policy violation or duplicate account"
                className={inputCls}
              />
            </Field>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setRevokeTarget(null)} className="btn-ghost rounded-full px-4 py-2 text-xs min-h-[44px]">
                Cancel
              </button>
              <button type="button" onClick={handleRevoke} className="px-5 py-2 rounded-full bg-rose-600 text-white text-xs font-medium min-h-[44px]">
                Confirm Revoke
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
