import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  LayoutDashboard,
  ScrollText,
  Users,
  ShieldCheck,
  ShieldAlert,
  HeartHandshake,
  Crown,
  CreditCard,
  TrendingUp,
  Landmark,
  Percent,
  CalendarCheck,
  Sparkles,
  Coffee,
  Ticket,
  Gift,
  Handshake,
  Bell as LucideBell,
  FileEdit,
  Scale,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Search,
  ArrowUpRight,
  LogOut,
  UserCheck,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Logo, GlowOrbs, PetalField, Badge } from "./ui";
import { useBackend, useAsync } from "../lib/data";
import { partnerOf } from "../pages/user/shared";

/* ============================== ScrollToTop ============================== */

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

/* ============================== Public nav ============================== */

const PUBLIC_LINKS = [
  { to: "/discover", label: "Discover" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/membership", label: "Membership" },
  { to: "/experiences", label: "Experiences" },
  { to: "/cafes", label: "Cafés" },
  { to: "/about", label: "About" },
];

export function PublicNav() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener("datevra:open-menu", open);
    return () => window.removeEventListener("datevra:open-menu", open);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "glass-strong shadow-2xl" : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-5 h-[72px] flex items-center justify-between">
        {/* Mobile: hamburger left (min 44x44 touch target) */}
        <button
          className="lg:hidden text-ivory text-2xl min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 rounded-xl active:bg-white/10 touch-manipulation"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? "×" : "☰"}
        </button>
        {/* Mobile: centered script logo */}
        <Link to="/" aria-label="Datevra home" className="lg:hidden absolute left-1/2 -translate-x-1/2 min-h-[44px] flex items-center">
          <span className="font-display text-[1.65rem] tracking-[0.14em] text-gradient-dream">
            Datevra
          </span>
        </Link>
        {/* Mobile: search + notifications right (min 44x44 touch target) */}
        <div className="lg:hidden flex items-center gap-1 -mr-2">
          <Link
            to="/discover"
            aria-label="Search"
            className="text-ivory-dim/90 hover:text-ivory min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl active:bg-white/10 text-xl transition-colors touch-manipulation"
          >
            ⌕
          </Link>
          <Link
            to={user ? "/notifications" : "/login"}
            aria-label="Notifications"
            className="relative text-ivory-dim/90 hover:text-ivory min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl active:bg-white/10 text-xl transition-colors touch-manipulation"
          >
            ◉
            {user && <NotifDot />}
          </Link>
        </div>
        {/* Desktop: logo left */}
        <Link to="/" aria-label="Datevra home" className="hidden lg:block">
          <Logo size={36} />
        </Link>
        <nav className="hidden lg:flex items-center gap-7" aria-label="Primary">
          {PUBLIC_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-[0.92rem] tracking-wide transition-colors ${
                  isActive ? "text-champagne" : "text-ivory-dim/85 hover:text-ivory"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden lg:flex items-center gap-3">
          {user ? (
            <>
              <Link
                to={isAdmin ? "/admin" : "/app"}
                className="btn-ghost rounded-full px-5 py-2.5 text-sm"
              >
                {isAdmin ? "Admin panel" : "My dashboard"}
              </Link>
              <button onClick={logout} className="text-sm text-mist hover:text-ivory transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm text-ivory-dim/90 hover:text-ivory transition-colors px-3 py-2">
                Sign in
              </Link>
              <Link to="/register" className="btn-gold rounded-full px-6 py-2.5 text-sm font-medium">
                Join Datevra
              </Link>
            </>
          )}
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden glass-strong border-t hairline overflow-hidden"
            aria-label="Mobile"
          >
            <div className="px-6 py-5 flex flex-col gap-2">
              {PUBLIC_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className="text-ivory/90 hover:text-champagne text-lg font-display min-h-[44px] flex items-center px-2 rounded-xl active:bg-white/10 transition-colors touch-manipulation"
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="pt-3 border-t hairline flex flex-col gap-3">
                {user ? (
                  <Link to={isAdmin ? "/admin" : "/app"} className="btn-gold rounded-full px-6 py-3 text-center font-medium">
                    {isAdmin ? "Admin panel" : "My dashboard"}
                  </Link>
                ) : (
                  <>
                    <Link to="/login" className="btn-ghost rounded-full px-6 py-3 text-center">
                      Sign in
                    </Link>
                    <Link to="/register" className="btn-gold rounded-full px-6 py-3 text-center font-medium">
                      Join Datevra
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ============================== Footer ============================== */

export function Footer() {
  return (
    <footer className="relative border-t hairline mt-24 bg-onyx/60">
      <div className="max-w-7xl mx-auto px-5 py-14 grid gap-10 md:grid-cols-4">
        <div>
          <Logo size={34} />
          <p className="mt-4 text-sm text-ivory-dim/80 leading-relaxed max-w-xs">
            A premium dating and curated date-experience platform. Meaningful connections,
            unforgettable evenings.
          </p>
        </div>
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold/80 mb-4">Explore</p>
          <ul className="space-y-2.5 text-sm text-ivory-dim/85">
            {[
              ["/discover", "Discover"],
              ["/membership", "Membership"],
              ["/experiences", "Curated experiences"],
              ["/cafes", "Cafés"],
              ["/how-it-works", "How it works"],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="hover:text-champagne transition-colors">{label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold/80 mb-4">Trust & safety</p>
          <ul className="space-y-2.5 text-sm text-ivory-dim/85">
            {[
              ["/safety", "Safety centre"],
              ["/faqs", "FAQs"],
              ["/contact", "Contact"],
              ["/about", "About us"],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="hover:text-champagne transition-colors">{label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold/80 mb-4">Legal</p>
          <ul className="space-y-2.5 text-sm text-ivory-dim/85">
            {[
              ["/terms", "Terms of service"],
              ["/privacy", "Privacy policy"],
              ["/refund", "Refund policy"],
              ["/admin", "Admin Panel"],
            ].map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="hover:text-champagne transition-colors">{label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t hairline">
        <div className="max-w-7xl mx-auto px-5 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-mist">
          <p>© 2026 Datevra. All rights reserved.</p>
          <p className="text-center md:text-right max-w-xl">
            Membership enhances visibility and priority — it never guarantees a match,
            relationship, or date.
          </p>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <GlowOrbs />
      <PublicNav />
      <main className={`flex-1 relative ${user ? "pb-24 lg:pb-0" : ""}`}>
        <Outlet />
      </main>
      <Footer />
      {user && <BottomNav />}
    </div>
  );
}

/* ============================== Route guards ============================== */

export function ProtectedRoute({ admin = false }: { admin?: boolean }) {
  const { session, ready } = useAuth();
  if (!ready) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <Logo size={48} withWordmark={false} />
        <p className="text-xs font-mono uppercase tracking-widest text-champagne/70 animate-pulse">
          Verifying authorization…
        </p>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (admin && session.role !== "admin") return <Navigate to="/app" replace />;
  return <Outlet />;
}

/* ============================== Member shell ============================== */

const USER_LINKS = [
  { to: "/app", label: "Dashboard", icon: "✦" },
  { to: "/discover", label: "Discover", icon: "◈" },
  { to: "/likes", label: "Likes", icon: "♥" },
  { to: "/matches", label: "Matches", icon: "✧" },
  { to: "/chat", label: "Chat", icon: "✉" },
  { to: "/experiences", label: "Experiences", icon: "❧" },
  { to: "/cafes", label: "Cafés", icon: "☕" },
  { to: "/membership", label: "Membership", icon: "♛" },
  { to: "/notifications", label: "Notifications", icon: "◉" },
  { to: "/profile", label: "Profile", icon: "❀" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

const BOTTOM_TABS = [
  { to: "/discover", label: "Discover", icon: "◈" },
  { to: "/likes", label: "Likes", icon: "♥" },
  { to: "/matches", label: "Matches", icon: "✧" },
  { to: "/chat", label: "Chat", icon: "✉" },
  { to: "/profile", label: "Profile", icon: "❀" },
];

interface MemberBadges {
  unreadChats: number;
  pendingLikes: number;
}

function useMemberNavBadges(userId?: string, enabled = true): MemberBadges {
  const db = useBackend();
  const [tick, setTick] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    const bump = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setTick((t) => t + 1), 200);
    };
    const offs = [
      db.subscribe("likes", bump),
      db.subscribe("matches", bump),
      db.subscribe("conversations", bump),
      db.subscribe("blocks", bump),
    ];
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      offs.forEach((off) => off());
    };
  }, [db, userId, enabled]);

  const { data } = useAsync(
    async (b): Promise<MemberBadges> => {
      if (!enabled || !userId) return { unreadChats: 0, pendingLikes: 0 };
      const [convs, recLikes, matches] = await Promise.all([
        b.conversationsFor(userId).catch(() => []),
        b.likesReceived(userId).catch(() => []),
        b.matchesFor(userId).catch(() => []),
      ]);
      const unreadChats = convs.reduce((n, c) => n + (c.unread[userId] ?? 0), 0);
      const matchedPartners = new Set(matches.map((m) => partnerOf(m, userId)));
      const pendingLikes = recLikes.filter((l) => !matchedPartners.has(l.fromUserId)).length;
      return { unreadChats, pendingLikes };
    },
    [enabled, userId, tick],
    { unreadChats: 0, pendingLikes: 0 } as MemberBadges,
  );

  return data;
}

function BottomNav({ badges }: { badges?: MemberBadges }) {
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const ownBadges = useMemberNavBadges(user?.id, badges === undefined);
  const activeBadges = badges ?? ownBadges;

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 glass-strong border-t hairline"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 h-[68px]">
        {BOTTOM_TABS.map((t) => {
          const badgeCount =
            t.to === "/chat"
              ? activeBadges.unreadChats
              : t.to === "/likes"
                ? activeBadges.pendingLikes
                : 0;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              aria-label={badgeCount > 0 ? `${t.label}, ${badgeCount} new` : t.label}
              className={({ isActive }) =>
                `relative min-w-0 min-h-[44px] px-0.5 flex flex-col items-center justify-center gap-1 text-[0.62rem] sm:text-[0.66rem] tracking-wide transition-colors ${
                  isActive ? "text-rosegold" : "text-mist hover:text-ivory-dim"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`text-[1.25rem] sm:text-[1.35rem] leading-none transition-all ${
                      isActive ? "scale-110 drop-shadow-[0_0_10px_rgba(255,61,154,0.8)]" : ""
                    }`}
                  >
                    {t.icon}
                  </span>
                  <span className="truncate max-w-full">{t.label}</span>
                  {badgeCount > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1/2 translate-x-3.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rosegold text-white text-[0.6rem] font-semibold flex items-center justify-center shadow-[0_0_12px_rgba(255,61,154,0.9)]"
                    >
                      {badgeCount > 9 ? "9+" : badgeCount}
                    </span>
                  )}
                  {isActive && (
                    <motion.span
                      layoutId={reducedMotion ? undefined : "bottom-tab-glow"}
                      className="absolute -top-px left-1/2 -translate-x-1/2 w-10 h-[3px] rounded-full bg-gradient-to-r from-rosegold to-champagne shadow-[0_0_12px_rgba(255,61,154,0.9)]"
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

function NotifDot() {
  const { user } = useAuth();
  const { data: count } = useAsync(
    (b) => (user ? b.unreadCount(user.id).catch(() => 0) : Promise.resolve(0)),
    [user?.id],
    0,
  );
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-rosegold text-white text-[0.6rem] font-semibold flex items-center justify-center shadow-[0_0_10px_rgba(255,61,154,0.9)]">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function Bell() {
  const { user } = useAuth();
  const db = useBackend();
  const nav = useNavigate();
  const { data: count, refresh } = useAsync(
    (b) => (user ? b.unreadCount(user.id) : Promise.resolve(0)),
    [user?.id],
    0,
  );
  useEffect(() => db.subscribe("notifications", refresh), [db, refresh]);
  return (
    <button
      onClick={() => nav("/notifications")}
      className="relative rounded-full min-h-[44px] min-w-[44px] p-2 flex items-center justify-center glass hover:border-rosegold/40 active:bg-white/10 transition-colors touch-manipulation"
      aria-label={`Notifications, ${count} unread`}
    >
      <span className="text-lg">◉</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-burgundy-soft text-[0.68rem] flex items-center justify-center border border-rosegold/40">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

export function UserShell() {
  const { user, logout } = useAuth();
  const db = useBackend();
  const reducedMotion = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const nav = useNavigate();
  const badges = useMemberNavBadges(user?.id, true);

  // Verifiable presence heartbeat (throttled every 5 minutes while member is active)
  useEffect(() => {
    if (!user) return;
    const sendHeartbeat = () => {
      db.updateUser(user.id, { lastActive: new Date().toISOString() }).catch(() => {});
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id, db]);

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link to="/app" className="px-6 pt-7 pb-5">
        <Logo size={32} />
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1" aria-label="Member">
        {USER_LINKS.map((l) => {
          const badgeCount =
            l.to === "/likes"
              ? badges.pendingLikes
              : l.to === "/chat"
                ? badges.unreadChats
                : 0;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/app"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 min-h-[44px] rounded-xl text-[0.93rem] transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-burgundy/70 to-burgundy-deep/40 text-ivory border border-rosegold/25"
                    : "text-ivory-dim/80 hover:text-ivory hover:bg-white/5 border border-transparent"
                }`
              }
            >
              <span className="w-5 text-center text-rosegold/90">{l.icon}</span>
              <span className="flex-1 truncate">{l.label}</span>
              {badgeCount > 0 && (
                <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-rosegold/90 text-white text-[0.68rem] font-semibold flex items-center justify-center">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-4 border-t hairline">
        <button
          onClick={() => {
            logout();
            nav("/");
          }}
          className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-mist hover:text-ivory hover:bg-white/5 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <GlowOrbs />
      <aside className="hidden lg:block w-[264px] shrink-0 border-r hairline bg-onyx/70 backdrop-blur-xl sticky top-0 h-screen">
        {sidebar}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-40 glass-strong border-b hairline">
          <div className="flex items-center justify-between px-4 md:px-8 h-[68px]">
            <div className="flex items-center gap-3">
              <button
                className="lg:hidden text-2xl text-ivory min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 rounded-xl active:bg-white/10 touch-manipulation"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                ☰
              </button>
              <Link
                to="/app"
                className="sm:hidden font-display text-lg tracking-[0.08em] text-gradient-dream min-h-[44px] flex items-center px-1"
                aria-label="Member dashboard"
              >
                Datevra
              </Link>
              <p className="font-display text-xl text-ivory hidden sm:block truncate">
                Welcome back, <span className="text-gradient-gold">{user?.firstName}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Bell />
              <Link to="/profile" aria-label="Your profile" className="min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation">
                <span className="inline-flex h-10 w-10 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/40 items-center justify-center font-display text-champagne">
                  {user?.firstName?.[0] ?? "?"}
                </span>
              </Link>
            </div>
          </div>
        </div>
        <main className="flex-1 px-4 md:px-8 py-8 pb-28 lg:pb-8 max-w-6xl w-full mx-auto relative min-w-0">
          <Outlet />
        </main>
      </div>
      <BottomNav badges={badges} />
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-[60] lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={reducedMotion ? { opacity: 0 } : { x: -300 }}
              animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { x: -300 }}
              transition={reducedMotion ? { duration: 0.12 } : { type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-[280px] z-[61] bg-onyx border-r hairline lg:hidden"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================== Admin shell ============================== */

/* ============================== Admin shell ============================== */

export interface AdminNavItem {
  to: string;
  label: string;
  group: "Command" | "People" | "Revenue" | "Experiences" | "Platform";
  icon: LucideIcon;
  badge?: string;
}

const ADMIN_LINKS: AdminNavItem[] = [
  // Command
  { to: "/admin", label: "Overview", group: "Command", icon: LayoutDashboard },
  { to: "/admin/activity", label: "Activity logs", group: "Command", icon: ScrollText },

  // People
  { to: "/admin/users", label: "Users", group: "People", icon: Users },
  { to: "/admin/verification", label: "Verification", group: "People", icon: ShieldCheck },
  { to: "/admin/reports", label: "Reports & safety", group: "People", icon: ShieldAlert },
  { to: "/admin/matchmaking", label: "Matchmaking", group: "People", icon: HeartHandshake },

  // Revenue
  { to: "/admin/memberships", label: "Memberships", group: "Revenue", icon: Crown },
  { to: "/admin/membership-passes", label: "Membership passes", group: "Revenue", icon: Gift },
  { to: "/admin/payments", label: "Payments", group: "Revenue", icon: CreditCard },
  { to: "/admin/analytics", label: "Revenue analytics", group: "Revenue", icon: TrendingUp },
  { to: "/admin/investors", label: "Investor ledger", group: "Revenue", icon: Landmark },
  { to: "/admin/commissions", label: "Commissions", group: "Revenue", icon: Percent },

  // Experiences
  { to: "/admin/applications", label: "Applications", group: "Experiences", icon: Sparkles },
  { to: "/admin/bookings", label: "Bookings", group: "Experiences", icon: CalendarCheck },
  { to: "/admin/cafes", label: "Cafés", group: "Experiences", icon: Coffee },
  { to: "/admin/passes", label: "Comp. passes", group: "Experiences", icon: Ticket },
  { to: "/admin/partnerships", label: "Partnerships", group: "Experiences", icon: Handshake },

  // Platform
  { to: "/admin/notifications", label: "Notifications", group: "Platform", icon: LucideBell },
  { to: "/admin/cms", label: "CMS", group: "Platform", icon: FileEdit },
  { to: "/admin/legal", label: "Legal pages", group: "Platform", icon: Scale },
  { to: "/admin/settings", label: "Settings", group: "Platform", icon: Sliders },
];

function AdminBell() {
  const { session } = useAuth();
  const db = useBackend();
  const nav = useNavigate();
  const { data: count, refresh } = useAsync(
    (b) =>
      b
        .notificationsFor(session?.userId ?? "")
        .then((ns) => ns.filter((n) => !n.read).length)
        .catch(() => 0),
    [session?.userId],
    0,
  );
  useEffect(() => db.subscribe("notifications", refresh), [db, refresh]);
  return (
    <button
      onClick={() => nav("/admin/notifications")}
      className="relative rounded-xl min-h-[44px] min-w-[44px] p-2.5 flex items-center justify-center glass hover:border-rosegold/40 active:bg-white/10 transition-all text-ivory-dim hover:text-ivory group touch-manipulation"
      aria-label={`Admin notifications, ${count} unread`}
      title="Notifications"
    >
      <LucideBell size={18} className="transition-transform group-hover:scale-105" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-rosegold to-burgundy text-[0.62rem] font-bold text-ivory flex items-center justify-center border border-rosegold/50 shadow-sm animate-pulse">
          {count}
        </span>
      )}
    </button>
  );
}

export function AdminShell() {
  const { logout, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("datevra:admin_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loc = useLocation();
  const nav = useNavigate();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
  }, [loc.pathname]);

  // Save collapsed state
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("datevra:admin_sidebar_collapsed", String(next));
      } catch {
        /* no-op */
      }
      return next;
    });
  };

  // Keyboard shortcut Ctrl/Cmd + K for quick route search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Compute current page info & breadcrumb
  const currentLink =
    ADMIN_LINKS.find((l) =>
      l.to === "/admin"
        ? loc.pathname === "/admin"
        : loc.pathname === l.to || loc.pathname.startsWith(`${l.to}/`),
    ) ?? ADMIN_LINKS[0];

  // Filtered links for search dialog
  const filteredSearchLinks = searchQuery.trim()
    ? ADMIN_LINKS.filter(
        (l) =>
          l.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.group.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.to.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : ADMIN_LINKS;

  // Sidebar navigation markup builder
  const renderNavLinks = (isSidebarCollapsed: boolean) => {
    return (
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5" aria-label="Admin Navigation">
        {ADMIN_LINKS.map((l, idx) => {
          const isFirstInGroup = idx === 0 || l.group !== ADMIN_LINKS[idx - 1]?.group;
          const showHeader = !isSidebarCollapsed && isFirstInGroup;
          const Icon = l.icon;

          return (
            <div key={l.to}>
              {showHeader && (
                <p className="px-3 pt-4 pb-1 text-[0.62rem] uppercase tracking-[0.25em] text-mist/75 font-semibold">
                  {l.group}
                </p>
              )}
              {isSidebarCollapsed && isFirstInGroup && idx > 0 && (
                <div className="h-px bg-white/5 my-2 mx-2" />
              )}
              <div className="relative group/tooltip">
                <NavLink
                  to={l.to}
                  end={l.to === "/admin"}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl transition-all font-medium touch-manipulation ${
                      isSidebarCollapsed
                        ? "justify-center min-h-[44px] min-w-[44px] mx-auto"
                        : "px-3 py-2.5 min-h-[42px] text-[0.87rem]"
                    } ${
                      isActive
                        ? "bg-gradient-to-r from-burgundy/80 via-burgundy-deep/60 to-transparent text-ivory border-l-2 border-rosegold shadow-sm shadow-burgundy/20"
                        : "text-ivory-dim/75 hover:text-ivory hover:bg-white/[0.04] active:bg-white/[0.08] border-l-2 border-transparent"
                    }`
                  }
                  title={isSidebarCollapsed ? l.label : undefined}
                >
                  <Icon
                    size={18}
                    className={`shrink-0 transition-colors ${
                      loc.pathname === l.to || (l.to !== "/admin" && loc.pathname.startsWith(l.to))
                        ? "text-rosegold"
                        : "text-mist/80 group-hover/tooltip:text-ivory"
                    }`}
                  />
                  {!isSidebarCollapsed && (
                    <span className="truncate flex-1 tracking-wide">{l.label}</span>
                  )}
                </NavLink>

                {/* Tooltip in collapsed mode */}
                {isSidebarCollapsed && (
                  <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 hidden group-hover/tooltip:flex items-center z-[70]">
                    <div className="px-2.5 py-1 rounded-lg bg-onyx text-ivory text-xs whitespace-nowrap shadow-xl border hairline">
                      <span className="text-[0.68rem] uppercase tracking-wider text-mist block text-[0.6rem]">
                        {l.group}
                      </span>
                      {l.label}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </nav>
    );
  };

  const desktopSidebar = (
    <div className="flex flex-col h-full bg-[#0b0614]/95 backdrop-blur-2xl">
      {/* Brand Header */}
      <div
        className={`flex items-center border-b hairline h-[68px] ${
          collapsed ? "justify-center px-2" : "justify-between px-5"
        }`}
      >
        <Link to="/" className="flex items-center gap-2 overflow-hidden group">
          <Logo size={28} withWordmark={!collapsed} />
        </Link>
        {!collapsed && (
          <span className="text-[0.65rem]">
            <Badge tone="rose">Admin</Badge>
          </span>
        )}
      </div>

      {/* Nav List */}
      {renderNavLinks(collapsed)}

      {/* Footer Utility Actions */}
      <div className={`border-t hairline bg-black/20 ${collapsed ? "p-2 space-y-1" : "p-3 space-y-1"}`}>
        {/* Switch to member view */}
        <Link
          to="/app"
          className={`flex items-center rounded-xl text-ivory-dim/80 hover:text-ivory hover:bg-white/5 transition-colors group/tooltip relative ${
            collapsed ? "justify-center h-10 w-10 mx-auto" : "px-3 py-2 text-xs gap-2.5"
          }`}
          title={collapsed ? "Switch to Member View" : undefined}
        >
          <ArrowUpRight size={16} className="text-mist group-hover/tooltip:text-rosegold transition-colors shrink-0" />
          {!collapsed && <span className="font-medium">Switch to Member View</span>}
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 hidden group-hover/tooltip:block z-[70]">
              <div className="px-2.5 py-1 rounded-lg bg-onyx text-ivory text-xs whitespace-nowrap shadow-xl border hairline">
                Switch to Member View
              </div>
            </div>
          )}
        </Link>

        {/* Sign out */}
        <button
          onClick={() => {
            logout();
            nav("/");
          }}
          className={`w-full flex items-center rounded-xl text-mist hover:text-rose-300 hover:bg-rose-500/10 transition-colors group/tooltip relative ${
            collapsed ? "justify-center h-10 w-10 mx-auto" : "px-3 py-2 text-xs gap-2.5 text-left"
          }`}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut size={16} className="text-mist group-hover/tooltip:text-rose-400 transition-colors shrink-0" />
          {!collapsed && <span className="font-medium">Sign out</span>}
          {collapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 hidden group-hover/tooltip:block z-[70]">
              <div className="px-2.5 py-1 rounded-lg bg-onyx text-ivory text-xs whitespace-nowrap shadow-xl border hairline">
                Sign out
              </div>
            </div>
          )}
        </button>

        {/* Collapse toggle button */}
        <div className="pt-1">
          <button
            onClick={toggleCollapsed}
            className={`w-full flex items-center rounded-xl text-mist/75 hover:text-ivory hover:bg-white/5 transition-colors ${
              collapsed ? "justify-center h-9 w-10 mx-auto" : "px-3 py-1.5 text-[0.72rem] justify-between"
            }`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {!collapsed && <span className="uppercase tracking-widest text-[0.62rem]">Collapse menu</span>}
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>
    </div>
  );

  const mobileSidebar = (
    <div className="flex flex-col h-full bg-[#0d0718] text-ivory">
      {/* Mobile Header */}
      <div className="flex items-center justify-between px-5 h-[68px] border-b hairline">
        <Link to="/" className="flex items-center gap-2">
          <Logo size={28} />
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-xl text-mist hover:text-ivory active:bg-white/10 touch-manipulation"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      {/* Links */}
      {renderNavLinks(false)}

      {/* Mobile Footer */}
      <div className="p-4 border-t hairline space-y-2 bg-black/20">
        <Link
          to="/app"
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-ivory-dim hover:text-ivory hover:bg-white/5 font-medium"
        >
          <ArrowUpRight size={16} className="text-rosegold" />
          Switch to Member View
        </Link>
        <button
          onClick={() => {
            logout();
            nav("/");
          }}
          className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-xl text-sm text-mist hover:text-rose-300 hover:bg-white/5 font-medium"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex bg-[#0b0614] text-ivory antialiased selection:bg-rosegold/30 selection:text-ivory">
      <GlowOrbs />

      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 border-r hairline sticky top-0 h-screen transition-all duration-300 ease-in-out z-40 ${
          collapsed ? "w-[72px]" : "w-[260px]"
        }`}
      >
        {desktopSidebar}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 glass-strong border-b hairline bg-[#0b0614]/85 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 sm:px-6 md:px-8 h-[68px] gap-3">
            {/* Left: Mobile trigger & Breadcrumbs */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-xl text-ivory glass hover:border-rosegold/40 active:bg-white/10 transition-colors touch-manipulation"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu size={20} />
              </button>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-mist/75">
                  <span className="hover:text-ivory transition-colors">Admin</span>
                  <span>/</span>
                  <span className="text-mist">{currentLink.group}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="font-display text-lg sm:text-xl font-medium tracking-wide text-ivory truncate">
                    {currentLink.label}
                  </h1>
                </div>
              </div>
            </div>

            {/* Right: Quick Search + Notifications + Admin Identity */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Quick Route Search Button */}
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-3 min-h-[44px] rounded-xl glass hover:border-rosegold/40 active:bg-white/10 text-xs text-mist hover:text-ivory transition-all group touch-manipulation"
                aria-label="Search admin navigation"
              >
                <Search size={14} className="text-mist group-hover:text-rosegold transition-colors" />
                <span className="hidden sm:inline">Search...</span>
                <kbd className="hidden md:inline-block px-1.5 py-0.5 rounded bg-white/10 text-[0.62rem] text-ivory-dim font-mono border border-white/10">
                  ⌘K
                </kbd>
              </button>

              {/* Notification Bell (reusing safe backend notifications) */}
              <AdminBell />

              {/* Admin Identity Area */}
              <div className="flex items-center gap-2.5 pl-2 border-l hairline">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-burgundy to-rosegold/40 flex items-center justify-center text-ivory font-display font-semibold text-sm border border-rosegold/30 shadow-inner">
                  {user?.firstName ? user.firstName[0]?.toUpperCase() : user?.email ? user.email[0]?.toUpperCase() : "A"}
                </div>
                <div className="hidden xl:flex flex-col text-left">
                  <span className="text-xs font-medium text-ivory truncate max-w-[140px] leading-tight">
                    {user?.firstName || (user?.email ? user.email.split("@")[0] : "Administrator")}
                  </span>
                  <span className="text-[0.62rem] text-mist flex items-center gap-1 leading-tight">
                    <UserCheck size={10} className="text-emerald-400" />
                    Admin
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 px-4 sm:px-6 md:px-8 py-8 max-w-7xl w-full mx-auto relative">
          <Outlet />
        </main>
      </div>

      {/* Mobile Slide-out Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60] lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 bottom-0 w-[280px] z-[61] border-r hairline lg:hidden shadow-2xl"
            >
              {mobileSidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Route Quick Search Modal (Command Palette) */}
      <AnimatePresence>
        {searchOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setSearchOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -10 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-lg rounded-2xl glass-strong border hairline shadow-2xl overflow-hidden bg-[#120a20] z-50"
            >
              {/* Search input */}
              <div className="flex items-center px-4 py-3.5 border-b hairline gap-3">
                <Search size={18} className="text-rosegold shrink-0" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Jump to admin section (e.g. Users, Verification, Payments)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-sm text-ivory placeholder-mist focus:outline-none"
                />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="p-1 rounded text-mist hover:text-ivory"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Results list */}
              <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                {filteredSearchLinks.length === 0 ? (
                  <p className="p-4 text-center text-xs text-mist">No matching routes found.</p>
                ) : (
                  filteredSearchLinks.map((l) => {
                    const Icon = l.icon;
                    return (
                      <button
                        key={l.to}
                        onClick={() => {
                          nav(l.to);
                          setSearchOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left text-xs hover:bg-white/10 text-ivory transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <Icon size={16} className="text-rosegold group-hover:scale-110 transition-transform" />
                          <span className="font-medium">{l.label}</span>
                        </div>
                        <span className="text-[0.65rem] uppercase tracking-wider text-mist">
                          {l.group}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2 border-t hairline bg-black/30 flex items-center justify-between text-[0.68rem] text-mist">
                <span>Navigate Datevra Admin</span>
                <span>ESC to close</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Splash layout for auth pages */
export function SplashLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-16">
      <GlowOrbs />
      <PetalField count={10} />
      {children}
    </div>
  );
}
