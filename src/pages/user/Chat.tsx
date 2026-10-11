import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { CONVERSATION_STARTERS } from "../../data/seed";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  Modal,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { timeAgo, useDbRefresh } from "./shared";
import type { Conversation, Message, UserProfile } from "../../lib/types";

const REPORT_REASONS = [
  "Inappropriate messages",
  "Harassment",
  "Spam or solicitation",
  "Fake profile",
  "Other",
];

// Modest hardcoded emoji set — pure UI affordance, not faked data.
const EMOJI_SET = [
  "😊", "😍", "😂", "🥰", "😘", "🤭", "😌", "😉",
  "✨", "💫", "🌙", "⭐", "💜", "💖", "❤️", "🔥",
  "🎉", "🥂", "🌹", "💐", "🍷", "☕", "🎵", "🙌",
];

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Read/delivery ticks rendered ONLY from the message's real delivered/read flags. */
function Ticks({ message }: { message: Message }) {
  if (!message.delivered) {
    return (
      <span className="text-ivory/40" aria-label="Sent">
        ✓
      </span>
    );
  }
  if (!message.read) {
    return (
      <span className="text-ivory/70" aria-label="Delivered">
        ✓✓
      </span>
    );
  }
  return (
    <span className="text-champagne" aria-label="Seen">
      ✓✓
    </span>
  );
}

type TimelineItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; msg: Message };

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const db = useBackend();

  const tick = useDbRefresh("conversations", "matches", "blocks", "notifications");

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [convSearch, setConvSearch] = useState("");
  const [msgSearch, setMsgSearch] = useState("");
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [confirmUnmatch, setConfirmUnmatch] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const typingTimer = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const me = user;
  const meId = me?.id;

  const {
    data: convs,
    loading: convsLoading,
    error: convsError,
    refresh: refreshConvs,
  } = useAsync(
    (b) => (meId ? b.conversationsFor(meId) : Promise.resolve([] as Conversation[])),
    [meId, tick],
    [] as Conversation[],
  );

  const convIdsKey = convs.map((c) => c.id).join(",");

  // Partner profiles for the conversation list.
  const { data: profileMap } = useAsync(
    async (b) => {
      const map = new Map<string, UserProfile>();
      if (!meId) return map;
      const ids = new Set<string>();
      convs.forEach((c) => c.participantIds.forEach((p) => ids.add(p)));
      const entries = await Promise.all(
        [...ids].map(async (id) => [id, await b.getUser(id)] as const),
      );
      entries.forEach(([id, p]) => {
        if (p) map.set(id, p);
      });
      return map;
    },
    [meId, convIdsKey, tick],
    new Map<string, UserProfile>(),
  );

  // Last-message previews for the conversation list.
  const { data: previews } = useAsync(
    async (b) => {
      const map = new Map<string, string>();
      for (const c of convs) {
        const ms = await b.messagesFor(c.id);
        const last = ms[ms.length - 1];
        map.set(
          c.id,
          last
            ? `${last.senderId === meId ? "You: " : ""}${last.text}`
            : "Say hello — be kind, be yourself.",
        );
      }
      return map;
    },
    [convIdsKey, meId],
    new Map<string, string>(),
  );

  const active = useMemo(
    () => convs.find((c) => c.id === activeId) ?? null,
    [convs, activeId],
  );

  const partnerId =
    active && meId ? active.participantIds.find((p) => p !== meId) : undefined;
  const partner = partnerId ? profileMap.get(partnerId) : undefined;

  // Subscribe to the active conversation.
  useEffect(() => {
    if (!meId || !activeId) {
      setMsgs([]);
      return;
    }
    let cancelled = false;
    db.messagesFor(activeId)
      .then((ms) => {
        if (!cancelled) setMsgs(ms);
      })
      .catch(() => {
        /* keep existing messages on error */
      });
    void db.markConversationRead(activeId, meId).then(() => refreshConvs());
    const offMsg = db.subscribeMessages(activeId, (m) => {
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      void db.markConversationRead(activeId, meId).then(() => refreshConvs());
    });
    const offType = db.subscribeTyping(activeId, (uid, typing) => {
      if (uid !== meId) setTypingFrom(typing ? uid : null);
    });
    return () => {
      cancelled = true;
      offMsg();
      offType();
      db.setTyping(activeId, meId, false);
      setTypingFrom(null);
    };
  }, [activeId, meId, db, refreshConvs]);

  // Autoscroll to latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, activeId]);

  // Debounced "I'm typing" state sent to the partner.
  const handleInput = (v: string) => {
    setInput(v);
    if (!active || !me) return;
    db.setTyping(active.id, me.id, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      if (active && me) db.setTyping(active.id, me.id, false);
    }, 1600);
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    handleInput(next);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(start + emoji.length, start + emoji.length);
      }
    });
  };

  const doSend = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || !active || !me || sending) return;
    setSending(true);
    try {
      const m = await db.sendMessage(active.id, me.id, text);
      if (!m) {
        toast("Message couldn't be sent.", "rose");
        return;
      }
      setInput("");
      db.setTyping(active.id, me.id, false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Message couldn't be sent.", "rose");
    } finally {
      setSending(false);
    }
  };

  if (!me) return null;

  const selectConv = (id: string) => {
    setParams({ c: id });
    setMenuOpen(false);
    setShowMsgSearch(false);
    setMsgSearch("");
  };

  const closeConv = () => {
    setParams({});
    setMenuOpen(false);
    setShowMsgSearch(false);
    setMsgSearch("");
  };

  const fillStarter = (s: string) =>
    s
      .replace("{interest}", partner?.interests[0] ?? partner?.hobbies[0] ?? "travel")
      .replace("{city}", partner?.city ?? "your city");

  const lastPreview = (convId: string) =>
    previews.get(convId) ?? "Say hello — be kind, be yourself.";

  const filteredConvs = convs.filter((c) => {
    const q = convSearch.trim().toLowerCase();
    if (!q) return true;
    const pid = c.participantIds.find((p) => p !== me.id);
    const p = pid ? profileMap.get(pid) : undefined;
    return (
      (p?.firstName ?? "").toLowerCase().includes(q) ||
      lastPreview(c.id).toLowerCase().includes(q)
    );
  });

  const visibleMsgs = msgSearch.trim()
    ? msgs.filter((m) => m.text.toLowerCase().includes(msgSearch.trim().toLowerCase()))
    : msgs;

  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];
    let lastDay = "";
    for (const m of visibleMsgs) {
      const dk = dayKey(m.createdAt);
      if (dk !== lastDay) {
        lastDay = dk;
        items.push({ kind: "day", key: `day-${dk}`, label: dayLabel(m.createdAt) });
      }
      items.push({ kind: "msg", msg: m });
    }
    return items;
  }, [visibleMsgs]);

  const doUnmatch = async () => {
    if (!active) return;
    try {
      await db.unmatch(active.matchId, me.id);
      setConfirmUnmatch(false);
      setParams({});
      toast("Match ended.", "rose");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't end the match.", "rose");
    }
  };

  const doBlock = async () => {
    if (!partner) return;
    try {
      await db.blockUser(me.id, partner.id);
      setConfirmBlock(false);
      setParams({});
      toast(`${partner.firstName} has been blocked.`, "rose");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't block right now.", "rose");
    }
  };

  const submitReport = async () => {
    if (!partner) return;
    try {
      await db.fileReport({
        reporterId: me.id,
        reportedId: partner.id,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setShowReport(false);
      setReportDetails("");
      setReportReason(REPORT_REASONS[0]);
      toast("Report submitted. Our safety team will review it.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't submit the report.", "rose");
    }
  };

  return (
    <div className="relative">
      {/* Dreamy ambient glows */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-burgundy/30 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-rosegold/15 blur-[120px]" />

      <div className="relative">
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Chat</p>
        <h1 className="font-display text-3xl mt-1 mb-6">
          <span className="text-gradient-dream">Conversations</span>
          <span aria-hidden className="animate-twinkle inline-block ml-2 text-rosegold">✦</span>
        </h1>

        {convsLoading ? (
          <div className="flex gap-4 h-[calc(100dvh-340px)] min-h-[480px]">
            <Skeleton className="w-full md:w-[340px] shrink-0" />
            <Skeleton className="hidden md:block flex-1" />
          </div>
        ) : convsError ? (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-ivory font-medium">Couldn't load conversations</p>
            <p className="text-sm text-mist mt-1">{convsError}</p>
            <button
              onClick={() => refreshConvs()}
              className="btn-ghost rounded-full px-6 py-2.5 text-sm mt-4"
            >
              Try again
            </button>
          </div>
        ) : convs.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            body="Conversations open when you and someone else like each other. Head to Discover to find your people."
            action={
              <Link
                to="/discover"
                className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block"
              >
                Discover people
              </Link>
            }
          />
        ) : (
          <div className="flex gap-4 h-[calc(100dvh-340px)] min-h-[480px]">
            {/* ── Conversation list ─────────────────────────────── */}
            <div
              className={`${active ? "hidden md:flex" : "flex"} flex-col w-full md:w-[340px] shrink-0 glass rounded-3xl overflow-hidden`}
            >
              <div className="p-4 border-b border-white/10">
                <div className="relative">
                  <svg
                    aria-hidden
                    className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-mist"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    className={`${inputCls} pl-10 rounded-full`}
                    placeholder="Search conversations…"
                    value={convSearch}
                    onChange={(e) => setConvSearch(e.target.value)}
                    aria-label="Search conversations"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar py-2">
                {filteredConvs.map((c) => {
                  const pid = c.participantIds.find((p) => p !== me.id);
                  const p = pid ? profileMap.get(pid) : undefined;
                  const unread = c.unread[me.id] ?? 0;
                  const isActive = c.id === activeId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => selectConv(c.id)}
                      className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-all duration-200 ${
                        isActive
                          ? "bg-gradient-to-r from-rosegold/15 to-transparent border-l-2 border-rosegold"
                          : "hover:bg-white/[0.04] border-l-2 border-transparent"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <Avatar name={p?.firstName ?? "?"} photo={p?.photos?.[0]} size={52} />
                        <span
                          aria-hidden
                          className={`absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-midnight ${
                            p?.online ? "bg-emerald-400" : "bg-white/25"
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`font-medium truncate ${
                              unread > 0 ? "text-ivory" : "text-ivory/90"
                            }`}
                          >
                            {p?.firstName ?? "Unknown"}
                          </p>
                          <span className="text-[0.7rem] text-mist/70 shrink-0">
                            {timeAgo(c.lastMessageAt)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p
                            className={`text-xs truncate ${
                              unread > 0 ? "text-ivory-dim font-medium" : "text-mist"
                            }`}
                          >
                            {lastPreview(c.id)}
                          </p>
                          {unread > 0 && (
                            <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-gradient-to-br from-rosegold to-burgundy text-ivory text-[0.7rem] font-bold flex items-center justify-center shadow-[0_2px_12px_rgba(255,61,154,0.5)]">
                              {unread > 99 ? "99+" : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredConvs.length === 0 && (
                  <p className="text-sm text-mist text-center py-10 px-6">
                    No conversations match “{convSearch.trim()}”.
                  </p>
                )}
              </div>
            </div>

            {/* ── Message pane ──────────────────────────────────── */}
            <div
              className={`${active ? "flex" : "hidden md:flex"} flex-col flex-1 glass rounded-3xl overflow-hidden min-w-0`}
            >
              {!active || !partner ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center max-w-sm">
                    <div className="mx-auto mb-5 h-16 w-16 rounded-full bg-gradient-to-br from-rosegold via-burgundy to-burgundy-deep flex items-center justify-center border border-blush/30 shadow-[0_8px_30px_rgba(255,61,154,0.35)]">
                      <span className="text-2xl" aria-hidden>
                        ✉
                      </span>
                    </div>
                    <p className="font-display text-2xl text-ivory">Your words, their heart</p>
                    <p className="text-sm text-mist mt-2 leading-relaxed">
                      Pick someone from the list to continue your conversation — or start a new
                      one from Discover.
                    </p>
                    <Link
                      to="/discover"
                      className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block mt-5"
                    >
                      Discover people
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="border-b border-white/10 bg-white/[0.02] px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 shrink-0">
                    <button
                      onClick={closeConv}
                      className="md:hidden text-mist hover:text-ivory transition-colors p-1.5 -ml-1"
                      aria-label="Back to conversations"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setShowProfile(true)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left group"
                      aria-label={`View ${partner.firstName}'s profile`}
                    >
                      <div className="relative shrink-0">
                        <Avatar name={partner.firstName} photo={partner.photos[0]} size={46} />
                        <span
                          aria-hidden
                          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-midnight ${
                            partner.online ? "bg-emerald-400" : "bg-white/25"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-ivory font-medium truncate group-hover:text-champagne transition-colors">
                          {partner.firstName}, {partner.age}
                        </p>
                        <p className="text-xs text-mist flex items-center gap-1.5 h-4">
                          {typingFrom ? (
                            <span className="text-rosegold font-medium">typing…</span>
                          ) : (
                            <>
                              <span
                                aria-hidden
                                className={`h-1.5 w-1.5 rounded-full ${
                                  partner.online ? "bg-emerald-400" : "bg-white/20"
                                }`}
                              />
                              <span className="truncate">
                                {partner.online
                                  ? "Online now"
                                  : `Last active ${timeAgo(partner.lastActive)}`}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => setShowMsgSearch((s) => !s)}
                      className={`p-2 rounded-full transition-colors ${
                        showMsgSearch ? "text-rosegold bg-rosegold/10" : "text-mist hover:text-ivory"
                      }`}
                      aria-label="Search messages"
                      aria-pressed={showMsgSearch}
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                      </svg>
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="text-mist hover:text-ivory transition-colors p-2"
                        aria-label="Conversation options"
                        aria-expanded={menuOpen}
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="19" cy="12" r="1.8" />
                        </svg>
                      </button>
                      <AnimatePresence>
                        {menuOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-11 z-20 glass-strong rounded-2xl p-2 w-52 shadow-2xl"
                          >
                            <button
                              onClick={() => { setShowProfile(true); setMenuOpen(false); }}
                              className="w-full text-left px-3 py-2.5 text-sm text-ivory hover:bg-white/5 rounded-xl transition-colors"
                            >
                              View profile
                            </button>
                            <button
                              onClick={() => { setShowReport(true); setMenuOpen(false); }}
                              className="w-full text-left px-3 py-2.5 text-sm text-ivory hover:bg-white/5 rounded-xl transition-colors"
                            >
                              Report
                            </button>
                            <div className="hairline my-1" />
                            <button
                              onClick={() => { setConfirmBlock(true); setMenuOpen(false); }}
                              className="w-full text-left px-3 py-2.5 text-sm text-rosegold hover:bg-white/5 rounded-xl transition-colors"
                            >
                              Block
                            </button>
                            <button
                              onClick={() => { setConfirmUnmatch(true); setMenuOpen(false); }}
                              className="w-full text-left px-3 py-2.5 text-sm text-rosegold hover:bg-white/5 rounded-xl transition-colors"
                            >
                              Unmatch
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* In-thread message search */}
                  <AnimatePresence>
                    {showMsgSearch && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-b border-white/10"
                      >
                        <div className="px-4 py-2.5">
                          <input
                            className="input-lux rounded-full px-4 py-2 text-sm w-full"
                            placeholder="Search in this conversation…"
                            value={msgSearch}
                            onChange={(e) => setMsgSearch(e.target.value)}
                            aria-label="Search messages in this conversation"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
                    {timeline.length === 0 && msgs.length === 0 ? (
                      <div className="text-center py-4">
                        <div
                          aria-hidden
                          className="mx-auto mb-4 h-12 w-12 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep flex items-center justify-center border border-rosegold/30"
                        >
                          <span className="animate-float-heart text-xl text-blush">♥</span>
                        </div>
                        <p className="text-sm text-mist mb-4 max-w-xs mx-auto leading-relaxed">
                          You're matched with {partner.firstName}. Break the ice with a starter:
                        </p>
                        <div className="space-y-2 max-w-md mx-auto">
                          {CONVERSATION_STARTERS.slice(0, 4).map((s) => (
                            <button
                              key={s}
                              onClick={() => void doSend(fillStarter(s))}
                              disabled={sending}
                              className="block w-full text-left glass rounded-2xl px-4 py-3 text-sm text-ivory-dim hover:text-ivory hover:border-rosegold/40 transition-colors disabled:opacity-50"
                            >
                              {fillStarter(s)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : timeline.length === 0 ? (
                      <p className="text-sm text-mist text-center py-10">
                        No messages match your search.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {timeline.map((item) =>
                          item.kind === "day" ? (
                            <div key={item.key} className="flex justify-center py-2.5">
                              <span className="glass rounded-full px-4 py-1 text-[0.68rem] uppercase tracking-[0.22em] text-mist">
                                {item.label}
                              </span>
                            </div>
                          ) : (
                            <motion.div
                              key={item.msg.id}
                              initial={{ opacity: 0, y: 10, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ duration: 0.22, ease: "easeOut" }}
                              className={`flex ${item.msg.senderId === me.id ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] sm:max-w-[72%] rounded-2xl px-4 py-2.5 ${
                                  item.msg.senderId === me.id ? "bubble-out" : "bubble-in"
                                }`}
                              >
                                <p className="text-[0.95rem] leading-relaxed whitespace-pre-wrap break-words text-ivory">
                                  {item.msg.text}
                                </p>
                                <p
                                  className={`text-[0.68rem] mt-1 flex items-center gap-1.5 ${
                                    item.msg.senderId === me.id ? "justify-end" : ""
                                  }`}
                                >
                                  <span className={item.msg.senderId === me.id ? "text-ivory/70" : "text-mist/70"}>
                                    {formatTime(item.msg.createdAt)}
                                  </span>
                                  {item.msg.senderId === me.id && (
                                    <Ticks message={item.msg} />
                                  )}
                                </p>
                              </div>
                            </motion.div>
                          ),
                        )}
                        {/* Typing indicator — from db.subscribeTyping, never simulated */}
                        <AnimatePresence>
                          {typingFrom && (
                            <motion.div
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 8 }}
                              transition={{ duration: 0.18 }}
                              className="flex justify-start pt-1"
                            >
                              <div className="bubble-in flex gap-1.5 items-center px-4 py-3.5" aria-label={`${partner.firstName} is typing`}>
                                {[0, 1, 2].map((i) => (
                                  <span
                                    key={i}
                                    className="animate-typing-dot h-1.5 w-1.5 rounded-full bg-rosegold"
                                    style={{ animationDelay: `${i * 0.2}s` }}
                                  />
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <div ref={bottomRef} />
                      </div>
                    )}
                  </div>

                  {/* Composer */}
                  <div
                    className="border-t border-white/10 bg-white/[0.02] px-3 sm:px-4 pt-3 shrink-0"
                    style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
                  >
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void doSend();
                      }}
                    >
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowEmoji((s) => !s)}
                          className={`p-2.5 rounded-full transition-colors ${
                            showEmoji ? "text-rosegold bg-rosegold/10" : "text-mist hover:text-ivory"
                          }`}
                          aria-label="Add emoji"
                          aria-expanded={showEmoji}
                        >
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M8 14.5c1 1.2 2.4 1.8 4 1.8s3-.6 4-1.8" strokeLinecap="round" />
                            <circle cx="9" cy="9.5" r="0.6" fill="currentColor" />
                            <circle cx="15" cy="9.5" r="0.6" fill="currentColor" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {showEmoji && (
                            <>
                              <button
                                type="button"
                                aria-hidden
                                tabIndex={-1}
                                className="fixed inset-0 z-10 cursor-default"
                                onClick={() => setShowEmoji(false)}
                              />
                              <motion.div
                                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                                transition={{ duration: 0.15 }}
                                className="absolute bottom-12 left-0 z-20 glass-strong rounded-2xl p-3 w-[248px] shadow-2xl"
                                role="dialog"
                                aria-label="Emoji picker"
                              >
                                <div className="grid grid-cols-8 gap-1">
                                  {EMOJI_SET.map((e) => (
                                    <button
                                      key={e}
                                      type="button"
                                      onClick={() => insertEmoji(e)}
                                      className="text-xl p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                                      aria-label={`Insert ${e}`}
                                    >
                                      {e}
                                    </button>
                                  ))}
                                </div>
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                      <button
                        type="button"
                        disabled
                        title="Photo sharing is coming soon"
                        aria-label="Attach a photo (coming soon)"
                        className="p-2.5 rounded-full text-mist/50 opacity-40 cursor-not-allowed"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path
                            d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <input
                        ref={inputRef}
                        className="input-lux rounded-full px-5 py-3 text-sm flex-1 min-w-0"
                        placeholder={`Message ${partner.firstName}…`}
                        value={input}
                        onChange={(e) => handleInput(e.target.value)}
                        maxLength={2000}
                        aria-label={`Message ${partner.firstName}`}
                      />
                      <button
                        type="submit"
                        disabled={!input.trim() || sending}
                        className="btn-gold rounded-full h-11 w-11 shrink-0 flex items-center justify-center disabled:opacity-40 transition-opacity"
                        aria-label="Send message"
                      >
                        {sending ? (
                          <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                        ) : (
                          <svg className="h-5 w-5 text-ivory" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M3.4 20.4 21.85 12 3.4 3.6l-.01 6.53L14 12 3.39 13.87l.01 6.53Z" />
                          </svg>
                        )}
                      </button>
                    </form>
                    {sending && (
                      <p className="text-[0.7rem] text-mist/80 text-center pt-1.5">Sending…</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Partner profile */}
      <Modal
        open={showProfile}
        onClose={() => setShowProfile(false)}
        title={partner ? `${partner.firstName}, ${partner.age}` : ""}
      >
        {partner && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar name={partner.firstName} photo={partner.photos[0]} size={64} ring />
              <div>
                <p className="text-mist">{partner.city}</p>
                {partner.verified && <Badge tone="green">✓ Verified</Badge>}
              </div>
            </div>
            {partner.bio && (
              <p className="text-ivory-dim text-sm leading-relaxed">{partner.bio}</p>
            )}
            {partner.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {partner.photos.map((url, i) => (
                  <div
                    key={url}
                    className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                  >
                    <img
                      src={url}
                      alt={`${partner.firstName}'s photo ${i + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )}
            {partner.interests.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {partner.interests.map((i) => (
                  <span
                    key={i}
                    className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne"
                  >
                    {i}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Report */}
      <Modal open={showReport} onClose={() => setShowReport(false)} title="Report conversation">
        <p className="text-sm text-mist mb-4">
          Reports are reviewed by our safety team. The person won't be told who reported them.
        </p>
        <Field label="Reason">
          <select
            className={inputCls}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-4">
          <Field label="Details (optional)">
            <textarea
              className={`${inputCls} min-h-[90px]`}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="What happened?"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setShowReport(false)}
            className="btn-ghost rounded-full px-5 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submitReport}
            className="btn-gold rounded-full px-5 py-2 text-sm"
          >
            Submit report
          </button>
        </div>
      </Modal>

      {/* Unmatch confirm */}
      <Modal open={confirmUnmatch} onClose={() => setConfirmUnmatch(false)} title="End this match?">
        <p className="text-sm text-ivory-dim leading-relaxed">
          This will permanently close the conversation and remove the match for both of you. This
          can't be undone.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setConfirmUnmatch(false)}
            className="btn-ghost rounded-full px-5 py-2 text-sm"
          >
            Keep chatting
          </button>
          <button
            onClick={doUnmatch}
            className="rounded-full px-5 py-2 text-sm bg-burgundy text-ivory hover:bg-burgundy-deep transition-colors"
          >
            Yes, unmatch
          </button>
        </div>
      </Modal>

      {/* Block confirm */}
      <Modal
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={`Block ${partner?.firstName ?? "this person"}?`}
      >
        <p className="text-sm text-ivory-dim leading-relaxed">
          They won't be able to message you or see your profile, and the conversation will close.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setConfirmBlock(false)}
            className="btn-ghost rounded-full px-5 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={doBlock}
            className="rounded-full px-5 py-2 text-sm bg-burgundy text-ivory hover:bg-burgundy-deep transition-colors"
          >
            Block
          </button>
        </div>
      </Modal>
    </div>
  );
}
