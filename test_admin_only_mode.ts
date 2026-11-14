import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MemoryRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import * as mockDb from "./src/lib/mockDb";
import {
  DESIGNATED_ADMIN_ONLY_USER_ID,
  isDesignatedAdminSession,
  hasStoredAuthHint,
} from "./src/context/AuthContext";

function LocationProbe({ id }: { id: string }) {
  const loc = useLocation();
  return React.createElement("div", { id }, `${id}:${loc.pathname}`);
}

function RedirectProbe({ to }: { to: string; replace?: boolean }) {
  return React.createElement("div", { id: "redirect-probe", "data-to": to }, `REDIRECT:${to}`);
}

/**
 * Mirrors the exact guard logic in src/components/layout.tsx, dual-mode pages,
 * and auth/recovery routes so router transitions across all three account types
 * (Designated Admin, Other Authorized Admin, Ordinary Member) are exercised cleanly.
 */
function GuardedRouter({
  url,
  ready,
  session,
  storedHint = false,
  isRecoveryFlow = false,
}: {
  url: string;
  ready: boolean;
  session: { userId: string; role: "user" | "admin" } | null;
  storedHint?: boolean;
  isRecoveryFlow?: boolean;
}) {
  const isAdmin = session?.role === "admin";
  const isDesignatedAdminOnly = isDesignatedAdminSession(session);

  function TestPublicLayout() {
    if (!ready && storedHint) {
      return React.createElement("div", { id: "auth-loading" }, "Verifying authorization…");
    }
    if (ready && isDesignatedAdminOnly) {
      return React.createElement(RedirectProbe, { to: "/admin", replace: true });
    }
    return React.createElement(
      "div",
      { id: "public-layout" },
      React.createElement(Outlet),
      session && !isDesignatedAdminOnly
        ? React.createElement("nav", { id: "bottom-nav" }, "MemberBottomNav")
        : null,
    );
  }

  function TestProtectedRoute({ admin = false }: { admin?: boolean }) {
    if (!ready) {
      return React.createElement("div", { id: "auth-loading" }, "Verifying authorization…");
    }
    if (!session) return React.createElement(RedirectProbe, { to: "/login", replace: true });
    if (admin && session.role !== "admin") return React.createElement(RedirectProbe, { to: "/app", replace: true });
    if (!admin && isDesignatedAdminOnly) return React.createElement(RedirectProbe, { to: "/admin", replace: true });
    return React.createElement(Outlet);
  }

  function TestDualMode({ name }: { name: string }) {
    if (!ready && storedHint) return null;
    if (ready && isDesignatedAdminOnly) return React.createElement(RedirectProbe, { to: "/admin", replace: true });
    if (!session || isDesignatedAdminOnly) return React.createElement("div", { id: `${name}-public` }, `${name} public`);
    return React.createElement("div", { id: `${name}-member` }, `${name} member`);
  }

  function TestForgot() {
    if ((!ready && storedHint) || (ready && isDesignatedAdminOnly)) {
      return React.createElement(RedirectProbe, { to: "/admin", replace: true });
    }
    return React.createElement("div", { id: "forgot-form" }, "Reset your password");
  }

  function TestResetPassword() {
    if (!ready && storedHint) return null;
    if (ready && isDesignatedAdminOnly && !isRecoveryFlow) {
      return React.createElement(RedirectProbe, { to: "/admin", replace: true });
    }
    return React.createElement("div", { id: "reset-password-form" }, isRecoveryFlow ? "RecoveryForm" : "InvalidOrActiveForm");
  }

  function TestUserShell() {
    return React.createElement(
      "div",
      { id: "user-shell" },
      isAdmin && !isDesignatedAdminOnly
        ? React.createElement("a", { href: "/admin", id: "return-to-admin" }, "← Admin panel")
        : null,
      React.createElement(Outlet),
    );
  }

  function TestAdminShell() {
    return React.createElement(
      "div",
      { id: "admin-shell" },
      !isDesignatedAdminOnly
        ? React.createElement("a", { href: "/app", id: "switch-member-view" }, "Switch to Member View")
        : null,
      React.createElement(Outlet),
    );
  }

  return React.createElement(
    MemoryRouter,
    { initialEntries: [url] },
    React.createElement(
      Routes,
      null,
      React.createElement(
        Route,
        { element: React.createElement(TestPublicLayout) },
        React.createElement(Route, { index: true, element: React.createElement(LocationProbe, { id: "home" }) }),
        React.createElement(Route, { path: "discover", element: React.createElement(TestDualMode, { name: "discover" }) }),
        React.createElement(Route, { path: "membership", element: React.createElement(TestDualMode, { name: "membership" }) }),
        React.createElement(Route, { path: "experiences", element: React.createElement(TestDualMode, { name: "experiences" }) }),
        React.createElement(Route, { path: "cafes", element: React.createElement(TestDualMode, { name: "cafes" }) }),
      ),
      React.createElement(Route, { path: "login", element: React.createElement(LocationProbe, { id: "login" }) }),
      React.createElement(Route, { path: "forgot", element: React.createElement(TestForgot) }),
      React.createElement(Route, { path: "reset-password", element: React.createElement(TestResetPassword) }),
      React.createElement(
        Route,
        { element: React.createElement(TestProtectedRoute) },
        React.createElement(Route, { path: "onboarding", element: React.createElement(LocationProbe, { id: "onboarding" }) }),
        React.createElement(
          Route,
          { element: React.createElement(TestUserShell) },
          React.createElement(Route, { path: "app", element: React.createElement(LocationProbe, { id: "member-app" }) }),
          React.createElement(Route, { path: "likes", element: React.createElement(LocationProbe, { id: "member-likes" }) }),
          React.createElement(Route, { path: "matches", element: React.createElement(LocationProbe, { id: "member-matches" }) }),
          React.createElement(Route, { path: "chat", element: React.createElement(LocationProbe, { id: "member-chat" }) }),
          React.createElement(Route, { path: "profile", element: React.createElement(LocationProbe, { id: "member-profile" }) }),
        ),
      ),
      React.createElement(
        Route,
        { element: React.createElement(TestProtectedRoute, { admin: true }) },
        React.createElement(
          Route,
          { element: React.createElement(TestAdminShell) },
          React.createElement(Route, { path: "admin", element: React.createElement(LocationProbe, { id: "admin-panel" }) }),
          React.createElement(Route, { path: "admin/users", element: React.createElement(LocationProbe, { id: "admin-users" }) }),
          React.createElement(Route, { path: "admin/membership-passes", element: React.createElement(LocationProbe, { id: "admin-passes" }) }),
        ),
      ),
    ),
  );
}

describe("DATEVRA — DESIGNATED ADMIN-ONLY ACCOUNT MODE VERIFICATION", () => {
  const designatedAdminSession = { userId: DESIGNATED_ADMIN_ONLY_USER_ID, role: "admin" as const };
  const otherAdminSession = { userId: "admin-1", role: "admin" as const };
  const matchingIdNonAdminSession = { userId: DESIGNATED_ADMIN_ONLY_USER_ID, role: "user" as const };
  const ordinaryMemberSession = { userId: "you-1", role: "user" as const };

  it("1-2 & 6-9. Scopes Admin-Only restriction strictly to DESIGNATED_ADMIN_ONLY_USER_ID + admin role and restores Switch to Member View for other Admins", () => {
    assert.equal(DESIGNATED_ADMIN_ONLY_USER_ID, "e0934a1e-cbf4-434d-93f1-56ead67e8df7");
    assert.equal(isDesignatedAdminSession(designatedAdminSession), true);
    assert.equal(isDesignatedAdminSession(otherAdminSession), false);
    assert.equal(isDesignatedAdminSession(ordinaryMemberSession), false);
    // Test 12: Matching user ID without Admin authorization MUST return false
    assert.equal(isDesignatedAdminSession(matchingIdNonAdminSession), false);

    const authCtx = fs.readFileSync("src/context/AuthContext.tsx", "utf-8");
    assert.match(authCtx, /c\.rpc\("is_admin"\)/, "Preserves database RPC is_admin check");
    assert.match(
      authCtx,
      /finalRole:\s*"user"\s*\|\s*"admin"\s*=\s*role\s*===\s*"admin"\s*\|\|\s*Boolean\(profile\?\.isAdmin\)/,
      "Reconciles database role and isAdmin boolean",
    );
    assert.equal(/founder@datevra/i.test(authCtx), false, "Does not use email strings to determine Admin privileges");

    const layout = fs.readFileSync("src/components/layout.tsx", "utf-8");
    // Conditional Switch to Member View restored ONLY for !isDesignatedAdminOnly
    const switchMatches = layout.match(/Switch to Member View/g) ?? [];
    assert.ok(switchMatches.length >= 2, "Restores Switch to Member View in desktop & mobile AdminShell");
    assert.match(layout, /\{!isDesignatedAdminOnly && \(\s*<Link\s+to="\/app"/, "Gates Switch to Member View on !isDesignatedAdminOnly");
    assert.match(layout, /\{isAdmin && !isDesignatedAdminOnly && \(\s*<Link\s+to="\/admin"/, "Lets other Admins return from UserShell to /admin");
    assert.match(layout, /if\s*\(\s*!admin\s*&&\s*isDesignatedAdminOnly\s*\)\s*return\s*<Navigate\s+to="\/admin"\s+replace\s*\/>/, "ProtectedRoute blocks only isDesignatedAdminOnly from member routes");
    assert.match(layout, /if\s*\(\s*admin\s*&&\s*session\.role\s*!==\s*"admin"\s*\)\s*return\s*<Navigate\s+to="\/app"\s+replace\s*\/>/, "Ordinary members and non-admins stay blocked from /admin");
  });

  it("1-5. Designated Admin: lands on /admin, hides Switch to Member View, blocks all member/public routes, and preserves Admin refresh without flash", () => {
    // Login & ResetPassword send Admin to /admin
    const loginSrc = fs.readFileSync("src/pages/public/Login.tsx", "utf-8");
    assert.match(loginSrc, /navigate\(session\.role\s*===\s*"admin"\s*\?\s*"\/admin"\s*:\s*"\/app"/);

    // On /admin: renders Admin Panel without Switch to Member View
    for (const adminUrl of ["/admin", "/admin/users", "/admin/membership-passes"]) {
      const html = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: adminUrl, ready: true, session: designatedAdminSession }),
      );
      assert.ok(html.includes(adminUrl), `Designated Admin remains on ${adminUrl} after refresh`);
      assert.equal(html.includes("Switch to Member View"), false, "Designated Admin never sees Switch to Member View");
    }

    // Blocked member-only, dual-mode, public, and non-recovery /forgot /reset-password routes redirect to /admin
    for (const blockedUrl of [
      "/app",
      "/likes",
      "/matches",
      "/chat",
      "/profile",
      "/onboarding",
      "/discover",
      "/membership",
      "/experiences",
      "/cafes",
      "/",
      "/forgot",
      "/reset-password",
    ]) {
      const html = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: blockedUrl, ready: true, session: designatedAdminSession }),
      );
      assert.ok(html.includes("REDIRECT:/admin"), `Designated Admin on ${blockedUrl} redirects to /admin`);
      assert.equal(html.includes("member-"), false, `No member UI rendered on ${blockedUrl}`);
      assert.equal(html.includes("MemberBottomNav"), false, `No BottomNav rendered on ${blockedUrl}`);
    }

    // Pre-hydration stored-session guard avoids public-page flash while !ready
    const preReadyHtml = ReactDOMServer.renderToString(
      React.createElement(GuardedRouter, { url: "/", ready: false, session: null, storedHint: true }),
    );
    assert.ok(preReadyHtml.includes("Verifying authorization"), "Pre-hydration public route avoids flash when stored auth hint exists");
    assert.equal(preReadyHtml.includes("home:/"), false, "Home marketing UI does not flash before auth resolves");
  });

  it("6-9. Other authorized Admin: sees Switch to Member View, can switch to Member View (/app & dual-mode), and can return to Admin View", () => {
    for (const adminUrl of ["/admin", "/admin/users"]) {
      const html = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: adminUrl, ready: true, session: otherAdminSession }),
      );
      assert.ok(html.includes(adminUrl), `Other Admin retains access to ${adminUrl}`);
      assert.ok(html.includes("Switch to Member View"), "Other Admin sees Switch to Member View");
    }

    const memberDashHtml = ReactDOMServer.renderToString(
      React.createElement(GuardedRouter, { url: "/app", ready: true, session: otherAdminSession }),
    );
    assert.ok(memberDashHtml.includes("member-app:/app"), "Other Admin can access /app Member Dashboard");
    assert.ok(memberDashHtml.includes("← Admin panel"), "Other Admin can return to Admin Panel from UserShell");

    for (const dualUrl of ["/discover", "/membership", "/experiences", "/cafes"]) {
      const html = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: dualUrl, ready: true, session: otherAdminSession }),
      );
      assert.ok(html.includes("member"), `Other Admin sees member mode on ${dualUrl}`);
      assert.ok(html.includes("MemberBottomNav"), `Other Admin gets BottomNav on ${dualUrl}`);
    }

    // Public pages remain usable when browsing
    const homeHtml = ReactDOMServer.renderToString(
      React.createElement(GuardedRouter, { url: "/", ready: true, session: otherAdminSession }),
    );
    assert.ok(homeHtml.includes("home:/"), "Other Admin is not forcibly bounced off /");
  });

  it("10-12. Ordinary members & matching-ID non-admin user access /app normally and are blocked from /admin", () => {
    for (const nonAdminSession of [ordinaryMemberSession, matchingIdNonAdminSession]) {
      const appHtml = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: "/app", ready: true, session: nonAdminSession }),
      );
      assert.ok(appHtml.includes("member-app:/app"), "Non-admin accesses /app normally");
      assert.equal(appHtml.includes("← Admin panel"), false, "Non-admin never sees Admin panel return link");

      const blockedAdmin = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: "/admin", ready: true, session: nonAdminSession }),
      );
      assert.ok(blockedAdmin.includes("REDIRECT:/app"), "Non-admin (even with designated ID) is blocked from /admin");
      assert.equal(blockedAdmin.includes("admin-panel"), false, "Admin Panel never renders for non-admin");
    }
  });

  it("13. Verifies login, logout, and legitimate password recovery work cleanly for all account types", () => {
    // Source verification for logout race-condition fix & ResetPassword recovery detection
    const authCtx = fs.readFileSync("src/context/AuthContext.tsx", "utf-8");
    const logoutBlock = authCtx.slice(authCtx.indexOf("const logout = useCallback"), authCtx.indexOf("const sendPasswordReset"));
    assert.ok(logoutBlock.indexOf("setSession(null)") < logoutBlock.indexOf("supaSignOut"));

    const resetSrc = fs.readFileSync("src/pages/public/ResetPassword.tsx", "utf-8");
    assert.match(resetSrc, /PASSWORD_RECOVERY/);
    assert.match(resetSrc, /if\s*\(\s*!checking\s*&&\s*ready\s*&&\s*isDesignatedAdminOnly\s*&&\s*!isRecoveryFlow\s*&&\s*!done\s*\)/);
    assert.match(resetSrc, /navigate\(session\.role\s*===\s*"admin"\s*\?\s*"\/admin"\s*:\s*"\/app"/);

    // Ordinary member & other Admin can open /forgot and /reset-password
    for (const s of [null, ordinaryMemberSession, otherAdminSession]) {
      const forgotHtml = ReactDOMServer.renderToString(
        React.createElement(GuardedRouter, { url: "/forgot", ready: true, session: s }),
      );
      assert.ok(forgotHtml.includes("Reset your password"), "Members and other Admins can use /forgot");
    }

    // Even designated Admin clicking a real recovery link (?type=recovery -> isRecoveryFlow=true) can complete recovery
    const recoveryHtml = ReactDOMServer.renderToString(
      React.createElement(GuardedRouter, {
        url: "/reset-password",
        ready: true,
        session: designatedAdminSession,
        isRecoveryFlow: true,
      }),
    );
    assert.ok(recoveryHtml.includes("RecoveryForm"), "Legitimate recovery link works for designated Admin too");

    // Local mockDb login -> logout -> login round-trip preserves roles and stored hint
    const storage = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => storage.clear(),
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
      get length() {
        return storage.size;
      },
    };
    assert.equal(hasStoredAuthHint(), false);

    const adminRes = mockDb.login("admin@datevra.in", "test-pass-123");
    assert.equal(adminRes.ok, true);
    if (adminRes.ok) {
      assert.equal(adminRes.session.role, "admin");
      assert.equal(isDesignatedAdminSession(adminRes.session), false);
    }
    assert.equal(hasStoredAuthHint(), true);

    mockDb.logout();
    assert.equal(mockDb.getSession(), null);
    assert.equal(hasStoredAuthHint(), false);

    const memberRes = mockDb.login("demo@datevra.in", "member-pass-123");
    assert.equal(memberRes.ok, true);
    if (memberRes.ok) assert.equal(memberRes.session.role, "user");
    mockDb.logout();
  });
});
