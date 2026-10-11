import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { Logo, GlowOrbs, PetalField, Badge } from "./ui";
import { useBackend, useAsync } from "../lib/data";

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
        {/* Mobile: hamburger left */}
        <button
          className="lg:hidden text-ivory text-2xl px-1 -ml-1"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? "×" : "☰"}
        </button>
        {/* Mobile: centered script logo */}
        <Link to="/" aria-label="Datevra home" className="lg:hidden absolute left-1/2 -translate-x-1/2">
          <span className="font-display text-[1.65rem] tracking-[0.14em] text-gradient-dream">
            Datevra
          </span>
        </Link>
        {/* Mobile: search + notifications right */}
        <div className="lg:hidden flex items-center gap-4">
          <Link to="/discover" aria-label="Search" className="text-ivory-dim/90 hover:text-ivory text-xl transition-colors">
            ⌕
          </Link>
          <Link
            to={user ? "/notifications" : "/login"}
            aria-label="Notifications"
            className="relative text-ivory-dim/90 hover:text-ivory text-xl transition-colors"
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
            <div className="px-6 py-5 flex flex-col gap-4">
              {PUBLIC_LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} className="text-ivory/90 text-lg font-display">
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
  if (!ready) return null;
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
  { to: "/app", label: "Home", icon: "✦" },
  { to: "/discover", label: "Discover", icon: "◈" },
  { to: "/chat", label: "Chat", icon: "✉" },
  { to: "/cafes", label: "Cafés", icon: "☕" },
  { to: "/profile", label: "Profile", icon: "❀" },
];

function BottomNav() {
  const { user } = useAuth();
  const { data: unread } = useAsync(
    (b) => (user ? b.unreadCount(user.id).catch(() => 0) : Promise.resolve(0)),
    [user?.id],
    0,
  );
  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 glass-strong border-t hairline"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 h-[68px]">
        {BOTTOM_TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === "/app"}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-1 text-[0.66rem] tracking-wide transition-colors ${
                isActive ? "text-rosegold" : "text-mist hover:text-ivory-dim"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`text-[1.35rem] leading-none transition-all ${isActive ? "scale-110 drop-shadow-[0_0_10px_rgba(255,61,154,0.8)]" : ""}`}>
                  {t.icon}
                </span>
                {t.label}
                {t.to === "/chat" && unread > 0 && (
                  <span className="absolute top-1.5 right-1/2 translate-x-4 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-rosegold text-white text-[0.62rem] font-semibold flex items-center justify-center shadow-[0_0_12px_rgba(255,61,154,0.9)]">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
                {isActive && (
                  <motion.span
                    layoutId="bottom-tab-glow"
                    className="absolute -top-px left-1/2 -translate-x-1/2 w-10 h-[3px] rounded-full bg-gradient-to-r from-rosegold to-champagne shadow-[0_0_12px_rgba(255,61,154,0.9)]"
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
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
      className="relative rounded-full p-2.5 glass hover:border-rosegold/40 transition-colors"
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const nav = useNavigate();

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link to="/" className="px-6 pt-7 pb-5">
        <Logo size={32} />
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-1" aria-label="Member">
        {USER_LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/app"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-[0.93rem] transition-all ${
                isActive
                  ? "bg-gradient-to-r from-burgundy/70 to-burgundy-deep/40 text-ivory border border-rosegold/25"
                  : "text-ivory-dim/80 hover:text-ivory hover:bg-white/5 border border-transparent"
              }`
            }
          >
            <span className="w-5 text-center text-rosegold/90">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
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
                className="lg:hidden text-2xl text-ivory px-1"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                ☰
              </button>
              <p className="font-display text-xl text-ivory hidden sm:block">
                Welcome back, <span className="text-gradient-gold">{user?.firstName}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Bell />
              <Link to="/profile" aria-label="Your profile">
                <span className="inline-flex h-10 w-10 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep border border-rosegold/40 items-center justify-center font-display text-champagne">
                  {user?.firstName?.[0] ?? "?"}
                </span>
              </Link>
            </div>
          </div>
        </div>
        <main className="flex-1 px-4 md:px-8 py-8 pb-28 lg:pb-8 max-w-6xl w-full mx-auto relative">
          <Outlet />
        </main>
      </div>
      <BottomNav />
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
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
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

const ADMIN_LINKS: { to: string; label: string; group: string }[] = [
  { to: "/admin", label: "Overview", group: "Command" },
  { to: "/admin/activity", label: "Activity logs", group: "Command" },
  { to: "/admin/users", label: "Users", group: "People" },
  { to: "/admin/verification", label: "Verification", group: "People" },
  { to: "/admin/reports", label: "Reports & safety", group: "People" },
  { to: "/admin/matchmaking", label: "Matchmaking", group: "People" },
  { to: "/admin/memberships", label: "Memberships", group: "Revenue" },
  { to: "/admin/payments", label: "Payments", group: "Revenue" },
  { to: "/admin/analytics", label: "Revenue analytics", group: "Revenue" },
  { to: "/admin/investors", label: "Investor ledger", group: "Revenue" },
  { to: "/admin/commissions", label: "Commissions", group: "Revenue" },
  { to: "/admin/applications", label: "Date applications", group: "Experiences" },
  { to: "/admin/bookings", label: "Bookings", group: "Experiences" },
  { to: "/admin/cafes", label: "Cafés", group: "Experiences" },
  { to: "/admin/passes", label: "Comp. passes", group: "Experiences" },
  { to: "/admin/partnerships", label: "Partnerships", group: "Experiences" },
  { to: "/admin/notifications", label: "Notifications", group: "Platform" },
  { to: "/admin/cms", label: "CMS", group: "Platform" },
  { to: "/admin/legal", label: "Legal pages", group: "Platform" },
  { to: "/admin/settings", label: "Settings", group: "Platform" },
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
      className="relative rounded-full p-2.5 glass hover:border-rosegold/40 transition-colors"
      aria-label={`Admin notifications, ${count} unread`}
    >
      <span className="text-lg">◉</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-burgundy-soft text-[0.68rem] flex items-center justify-center border border-rosegold/40">
          {count}
        </span>
      )}
    </button>
  );
}

export function AdminShell() {
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const nav = useNavigate();

  let lastGroup = "";
  const sidebar = (
    <div className="flex flex-col h-full">
      <Link to="/" className="px-6 pt-7 pb-2">
        <Logo size={30} />
      </Link>
      <p className="px-6 pb-4">
        <Badge tone="rose">Admin console</Badge>
      </p>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Admin">
        {ADMIN_LINKS.map((l) => {
          const header =
            l.group !== lastGroup ? (
              <p key={l.group} className="px-4 pt-4 pb-1.5 text-[0.66rem] uppercase tracking-[0.3em] text-mist">
                {l.group}
              </p>
            ) : null;
          lastGroup = l.group;
          return (
            <div key={l.to}>
              {header}
              <NavLink
                to={l.to}
                end={l.to === "/admin"}
                className={({ isActive }) =>
                  `flex items-center px-4 py-2 rounded-lg text-[0.9rem] transition-all ${
                    isActive
                      ? "bg-gradient-to-r from-burgundy/70 to-burgundy-deep/40 text-ivory border border-rosegold/25"
                      : "text-ivory-dim/80 hover:text-ivory hover:bg-white/5 border border-transparent"
                  }`
                }
              >
                {l.label}
              </NavLink>
            </div>
          );
        })}
      </nav>
      <div className="p-4 border-t hairline space-y-1">
        <Link to="/app" className="block px-4 py-2 rounded-xl text-sm text-ivory-dim/85 hover:text-ivory hover:bg-white/5">
          View as member
        </Link>
        <button
          onClick={() => {
            logout();
            nav("/");
          }}
          className="w-full text-left px-4 py-2 rounded-xl text-sm text-mist hover:text-ivory hover:bg-white/5"
        >
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <GlowOrbs />
      <aside className="hidden lg:block w-[264px] shrink-0 border-r hairline bg-[#0d080d]/90 backdrop-blur-xl sticky top-0 h-screen">
        {sidebar}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-40 glass-strong border-b hairline">
          <div className="flex items-center justify-between px-4 md:px-8 h-[68px]">
            <div className="flex items-center gap-3">
              <button
                className="lg:hidden text-2xl text-ivory px-1"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                ☰
              </button>
              <p className="font-display text-xl text-ivory hidden sm:block">
                Admin <span className="text-gradient-gold">console</span>
              </p>
            </div>
            <AdminBell />
          </div>
        </div>
        <main className="flex-1 px-4 md:px-8 py-8 max-w-7xl w-full mx-auto relative">
          <Outlet />
        </main>
      </div>
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
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
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
