import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, Modal, Reveal, Skeleton, useToast } from "../../components/ui";
import {
  APP_STATUS_META,
  APP_TIMELINE,
  fmtDate,
  timeAgo,
  useDbRefresh,
} from "./shared";
import type { ApplicationStatus, DateApplication, DateExperience } from "../../lib/types";

const CANCELLABLE: ApplicationStatus[] = ["submitted", "under_review", "eligible"];

interface AppRow {
  app: DateApplication;
  exp: DateExperience | undefined;
}

export default function Applications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const tick = useDbRefresh("notifications");
  const [cancelFor, setCancelFor] = useState<string | null>(null);

  const {
    data: apps,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<AppRow[]> => {
      if (!user) return [];
      const list = await b.applicationsFor(user.id);
      const asc = list.slice().reverse();
      const exps = await Promise.all(
        asc.map((a) => b.getExperience(a.experienceId)),
      );
      return asc.map((a, i) => ({ app: a, exp: exps[i] }));
    },
    [user?.id, tick],
    [] as AppRow[],
  );

  if (!user) return null;
  const me = user;

  const doCancel = async () => {
    if (!cancelFor) return;
    try {
      await db.cancelApplication(cancelFor, me.id);
      setCancelFor(null);
      refresh();
      toast("Application withdrawn.", "rose");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't withdraw the application.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Curated experiences</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-2">Your applications</h1>
        <p className="text-sm text-mist mb-8">
          Our team reviews every application personally. Selection is never guaranteed — but every
          application gets a fair, human look.
        </p>
      </Reveal>

      <Reveal>
        <Link
          to="/experiences"
          className="glass rounded-3xl p-6 mb-8 flex items-center gap-5 card-hover block relative overflow-hidden"
        >
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-rosegold/10 blur-[80px]" />
          <span className="relative h-12 w-12 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/30 flex items-center justify-center text-xl text-champagne shrink-0">
            ☕
          </span>
          <span className="relative flex-1">
            <span className="block font-display text-xl text-ivory">Apply for another experience</span>
            <span className="block text-sm text-mist mt-0.5">
              Romantic cafés, premium dining, curated first dates — browse what's on.
            </span>
          </span>
          <span className="relative text-rosegold text-xl">→</span>
        </Link>
      </Reveal>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load applications: {error}</p>
      ) : apps.length === 0 ? (
        <EmptyState
          title="No applications yet"
          body="When you apply for a curated date experience, its journey from review to confirmation will be tracked here."
        />
      ) : (
        <div className="space-y-4">
          {apps.map(({ app: a, exp }) => {
            const meta = APP_STATUS_META[a.status];
            const stepIdx = APP_TIMELINE.indexOf(a.status);
            const terminal = a.status === "declined" || a.status === "cancelled";
            return (
              <Reveal key={a.id}>
                <div className="glass rounded-3xl p-6">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1 min-w-[200px]">
                      <p className="font-display text-xl text-ivory">{exp?.title ?? "Experience"}</p>
                      <p className="text-sm text-mist mt-1">
                        {exp?.kind} · {exp?.city} · {a.slotDate} at {a.slotTime}
                      </p>
                      <p className="text-xs text-mist/70 mt-1">Applied {timeAgo(a.createdAt)}</p>
                      {a.note && (
                        <p className="text-sm text-ivory-dim mt-3 italic">“{a.note}”</p>
                      )}
                      {a.adminNote && (
                        <p className="text-sm text-champagne/90 mt-2">
                          <span className="text-mist">Note from our team: </span>
                          {a.adminNote}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {CANCELLABLE.includes(a.status) && (
                        <button
                          onClick={() => setCancelFor(a.id)}
                          className="text-xs text-mist hover:text-ivory underline underline-offset-4"
                        >
                          Withdraw application
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Timeline */}
                  {!terminal ? (
                    <div className="mt-6 flex items-center">
                      {APP_TIMELINE.map((s, i) => {
                        const done = i < stepIdx;
                        const current = i === stepIdx;
                        return (
                          <div key={s} className="flex items-center flex-1 last:flex-none">
                            <div className="flex flex-col items-center">
                              <span
                                className={`h-7 w-7 rounded-full border flex items-center justify-center text-[0.65rem] ${
                                  done
                                    ? "bg-champagne/20 border-champagne/60 text-champagne"
                                    : current
                                      ? "bg-rosegold/20 border-rosegold text-rosegold animate-pulse"
                                      : "border-white/15 text-mist/50"
                                }`}
                              >
                                {done ? "✓" : i + 1}
                              </span>
                              <span
                                className={`text-[0.65rem] mt-1 whitespace-nowrap ${
                                  current ? "text-champagne" : "text-mist/60"
                                }`}
                              >
                                {APP_STATUS_META[s].label}
                              </span>
                            </div>
                            {i < APP_TIMELINE.length - 1 && (
                              <div className={`h-px flex-1 mx-1 mb-5 ${done ? "bg-champagne/50" : "bg-white/10"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-mist mt-4">
                      {a.decidedAt ? `Decided ${fmtDate(a.decidedAt)}. ` : ""}
                      You're welcome to apply for another experience anytime.
                    </p>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      )}

      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title="Withdraw application?">
        <p className="text-sm text-ivory-dim">
          This will withdraw your application. You can apply again for another slot if you change your mind.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCancelFor(null)} className="btn-ghost rounded-full px-5 py-2 text-sm">
            Keep it
          </button>
          <button onClick={doCancel} className="rounded-full px-5 py-2 text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors">
            Withdraw
          </button>
        </div>
      </Modal>
    </div>
  );
}
