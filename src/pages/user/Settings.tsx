import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useBackend } from "../../lib/data";
import { Field, Modal, Reveal, inputCls, useToast } from "../../components/ui";
import { useDbRefresh } from "./shared";

interface NotifPrefs {
  inapp: boolean;
  email: boolean;
  push: boolean;
}

const PREF_DEFAULTS: NotifPrefs = { inapp: true, email: true, push: false };
const PREF_KEY = "dv-notif-prefs";

const PREF_LABELS: { key: keyof NotifPrefs; title: string; desc: string }[] = [
  { key: "inapp", title: "In-app notifications", desc: "Matches, likes, messages and booking updates inside Datevra." },
  { key: "email", title: "Email notifications", desc: "Important updates like match alerts and payment receipts. (Activates once our email provider is configured.)" },
  { key: "push", title: "Push notifications", desc: "Browser push alerts for new messages and matches." },
];

export default function Settings() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  useDbRefresh("profiles");

  const [firstName, setFirstName] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotifPrefs>(() => {
    try {
      return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") };
    } catch {
      return PREF_DEFAULTS;
    }
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;
  const me = user;
  const nameValue = firstName === null ? me.firstName : firstName;

  const saveName = async () => {
    if (!nameValue.trim()) {
      toast("Name can't be empty.", "rose");
      return;
    }
    try {
      await db.updateUser(me.id, { firstName: nameValue.trim() });
      refresh();
      setFirstName(null);
      toast("Name updated.");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't update your name.",
        "rose",
      );
    }
  };

  const togglePref = (key: keyof NotifPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch {
      /* private mode — preferences apply for this session */
    }
    toast("Notification preferences saved.");
  };

  const signOut = () => {
    void logout();
    navigate("/");
  };

  const doReset = () => {
    db.resetDemo?.();
    void logout();
    setConfirmReset(false);
    toast("Demo data cleared. You've been signed out.", "rose");
    navigate("/");
  };

  const doDeleteAccount = async () => {
    if (deleteTyped.trim().toUpperCase() !== "DELETE") {
      toast('Please type DELETE to confirm.', "rose");
      return;
    }
    setDeleting(true);
    try {
      await db.deleteAccount(me.id);
      await logout();
      setConfirmDelete(false);
      toast("Your account and personal data have been permanently deleted.", "rose");
      navigate("/");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't delete your account. Please try again or contact support.",
        "rose",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Settings</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-8">Make it yours</h1>
      </Reveal>

      {/* Account */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <h2 className="font-display text-xl text-ivory mb-5">Account</h2>
          <div className="grid md:grid-cols-2 gap-5">
            <Field label="First name">
              <div className="flex gap-2">
                <input className={inputCls} value={nameValue} onChange={(e) => setFirstName(e.target.value)} maxLength={30} />
                <button onClick={saveName} className="btn-ghost rounded-xl px-4 text-sm shrink-0">
                  Save
                </button>
              </div>
            </Field>
            <Field label="Email" hint="Email can't be changed here — contact support if you need to update it.">
              <input className={`${inputCls} opacity-60`} value={me.email} readOnly />
            </Field>
          </div>
          <div className="flex justify-end mt-6">
            <button onClick={signOut} className="btn-ghost rounded-full px-6 py-2.5 text-sm">
              Sign out
            </button>
          </div>
        </section>
      </Reveal>

      {/* Notifications */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <h2 className="font-display text-xl text-ivory mb-2">Notifications</h2>
          <p className="text-sm text-mist mb-5">Stored on this device. Adjust anytime.</p>
          <div className="space-y-3">
            {PREF_LABELS.map(({ key, title, desc }) => (
              <label key={key} className="flex items-center justify-between gap-4 glass rounded-2xl px-5 py-4 cursor-pointer">
                <div>
                  <p className="text-ivory font-medium text-sm">{title}</p>
                  <p className="text-xs text-mist mt-0.5">{desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={() => togglePref(key)}
                  className="h-5 w-5 accent-[#e2a183] shrink-0"
                />
              </label>
            ))}
          </div>
        </section>
      </Reveal>

      {/* Appearance */}
      <Reveal>
        <section className="glass rounded-3xl p-6 md:p-8 mb-6">
          <h2 className="font-display text-xl text-ivory mb-2">Appearance</h2>
          <p className="text-sm text-ivory-dim">
            Datevra wears its signature midnight look — deep blacks, burgundy and rose-gold,
            designed for candle-lit scrolling. There's just the one theme, and it's ours.
          </p>
        </section>
      </Reveal>

      {/* Danger zone */}
      <Reveal>
        <section className="rounded-3xl p-6 md:p-8 border border-burgundy-soft/50 bg-burgundy-deep/20">
          <h2 className="font-display text-xl text-ivory mb-2">Danger zone</h2>
          <p className="text-sm text-ivory-dim mb-5">
            This demo stores all data locally in your browser. Resetting clears every profile,
            like, message and payment on this device and signs you out.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setConfirmReset(true)}
              className="rounded-full px-6 py-2.5 text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors"
            >
              Reset demo data
            </button>
            <button
              onClick={() => {
                setDeleteTyped("");
                setConfirmDelete(true);
              }}
              className="rounded-full px-6 py-2.5 text-sm border border-rose/60 text-rose hover:bg-rose hover:text-white transition-colors"
            >
              Delete my account
            </button>
          </div>
        </section>
      </Reveal>

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset all demo data?">
        <p className="text-sm text-ivory-dim">
          This permanently clears every profile, conversation, booking, payment and setting stored
          in this browser, and signs you out. This can't be undone.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConfirmReset(false)} className="btn-ghost rounded-full px-5 py-2 text-sm">
            Cancel
          </button>
          <button onClick={doReset} className="rounded-full px-5 py-2 text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors">
            Yes, reset everything
          </button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} title="Delete your account?">
        <div className="space-y-4 text-sm text-ivory-dim">
          <p className="text-rose font-medium">
            This is permanent and cannot be undone.
          </p>
          <p>Deleting your account will permanently remove:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Your profile, photos, bio, and preferences</li>
            <li>Your likes, matches, conversations, and messages</li>
            <li>Your applications, bookings, notifications, and saved items</li>
            <li>Your membership and subscriptions</li>
          </ul>
          <p>
            Payment records are kept in anonymized form (no name, email, or
            profile attached) for accounting and legal purposes — they can
            never be linked back to you.
          </p>
          <p>
            You will be signed out immediately. If you change your mind later, you'll need to
            create a brand-new account.
          </p>
          <Field label='Type DELETE to confirm'>
            <input
              className={inputCls}
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              disabled={deleting}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="btn-ghost rounded-full px-5 py-2 text-sm disabled:opacity-50"
          >
            Keep my account
          </button>
          <button
            onClick={() => void doDeleteAccount()}
            disabled={deleting || deleteTyped.trim().toUpperCase() !== "DELETE"}
            className="rounded-full px-5 py-2 text-sm bg-rose text-white hover:bg-rose/80 transition-colors disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Yes, delete everything"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
