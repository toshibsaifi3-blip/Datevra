import { useEffect, useState } from "react";
import type { PlatformSettings } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Field, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";

export default function Settings() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const actor = session?.userId ?? "admin-1";

  const { data: loaded, loading, error, refresh } = useAsync(
    (b) => b.getSettings(),
    [db],
    null as PlatformSettings | null,
  );

  useEffect(() => {
    if (loaded && form === null) setForm({ ...loaded });
  }, [loaded, form]);

  useEffect(() => db.subscribe("settings", refresh), [db, refresh]);

  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    if (!Number.isInteger(form.minAge) || form.minAge < 18) {
      toast("Minimum age must be 18 or above", "rose");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.supportEmail)) {
      toast("Enter a valid support email", "rose");
      return;
    }
    try {
      await db.saveSettings(form, actor);
      refresh();
      setDirty(false);
      toast("Platform settings saved", "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "rose");
    }
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
        on ? "bg-rosegold/60" : "bg-white/10"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-ivory transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-3xl mx-auto">
        <SectionHead
          kicker="Platform"
          title="Settings"
          sub="Global controls for the Datevra platform. Every change is audit-logged."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load settings: {error}</p>}

        {loading || form === null ? (
          <div className="glass rounded-3xl p-6 mt-10 space-y-6">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="glass rounded-3xl p-6 mt-10 space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-ivory font-medium">Maintenance mode</p>
                <p className="text-xs text-mist mt-1">Show a holding page to members while work happens.</p>
              </div>
              <Toggle on={form.maintenanceMode} onClick={() => set("maintenanceMode", !form.maintenanceMode)} />
            </div>

            <Field label="Minimum member age" hint="Datevra requires 18+ — this cannot go below 18.">
              <input
                type="number"
                min={18}
                value={form.minAge}
                onChange={(e) => set("minAge", Number(e.target.value))}
                className={inputCls}
              />
            </Field>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-ivory font-medium">Razorpay test mode</p>
                <p className="text-xs text-mist mt-1">
                  Keep ON until live credentials are configured. Test mode never charges real money.
                </p>
              </div>
              <Toggle on={form.razorpayTestMode} onClick={() => set("razorpayTestMode", !form.razorpayTestMode)} />
            </div>

            <Field label="Support email">
              <input
                value={form.supportEmail}
                onChange={(e) => set("supportEmail", e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Announcement" hint="Shown as a banner to members.">
              <textarea
                value={form.announcements}
                onChange={(e) => set("announcements", e.target.value)}
                className={`${inputCls} min-h-20`}
              />
            </Field>

            <button
              onClick={save}
              disabled={!dirty}
              className="btn-gold rounded-xl px-8 py-3 text-sm w-full disabled:opacity-40"
            >
              {dirty ? "Save settings" : "No changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
