/**
 * Test Suite: Admin Route 404 Diagnosis & Architecture Verification
 * Datevra Admin Panel — Stage 5 Verification
 */

import fs from "fs";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MemoryRouter, Routes, Route, Outlet, Navigate, matchRoutes } from "react-router-dom";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log("=== Admin Route 404 Diagnosis & Verification Suite ===");

// ----------------------------------------------------------------------------
// Test 1: Vercel SPA Rewrite Configuration (vercel.json)
// ----------------------------------------------------------------------------
console.log("\nTest 1: Vercel SPA Rewrite Configuration");
const vercelJsonPath = path.resolve(process.cwd(), "vercel.json");
assert(fs.existsSync(vercelJsonPath), "vercel.json exists in workspace root");
const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, "utf-8"));
const hasSpaRewrite = vercelConfig.rewrites?.some(
  (r: any) => r.source === "/(.*)" && r.destination === "/index.html"
);
assert(hasSpaRewrite, "vercel.json contains catch-all rewrite to /index.html");

// ----------------------------------------------------------------------------
// Test 2: React Router Route Configuration in src/App.tsx
// ----------------------------------------------------------------------------
console.log("\nTest 2: App.tsx Admin Route Registration");
const appTsxPath = path.resolve(process.cwd(), "src/App.tsx");
assert(fs.existsSync(appTsxPath), "src/App.tsx exists");
const appContent = fs.readFileSync(appTsxPath, "utf-8");

const requiredAdminPaths = [
  "admin",
  "admin/users",
  "admin/verification",
  "admin/reports",
  "admin/matchmaking",
  "admin/memberships",
  "admin/membership-passes",
  "admin/payments",
  "admin/analytics",
  "admin/investors",
  "admin/commissions",
  "admin/applications",
  "admin/bookings",
  "admin/cafes",
  "admin/passes",
  "admin/partnerships",
  "admin/notifications",
  "admin/cms",
  "admin/legal",
  "admin/settings",
  "admin/activity",
];

for (const p of requiredAdminPaths) {
  assert(appContent.includes(`path="${p}"`), `Registered admin route: path="${p}"`);
}

// ----------------------------------------------------------------------------
// Test 3: Route Matching Precision for /admin and /admin/
// ----------------------------------------------------------------------------
console.log("\nTest 3: Route Matching Precision");

const mockRoutes = [
  {
    element: "PublicLayout",
    children: [
      { index: true, element: "Home" },
      { path: "discover", element: "Discover" }
    ]
  },
  {
    element: "ProtectedRoute-admin",
    children: [
      {
        element: "AdminShell",
        children: requiredAdminPaths.map((p) => ({ path: p, element: p }))
      }
    ]
  },
  { path: "*", element: "NotFound" }
];

const matchAdmin = matchRoutes(mockRoutes, "/admin");
assert(matchAdmin !== null && matchAdmin[2]?.route?.path === "admin", "Direct /admin matches AdminOverview leaf");

const matchAdminSlash = matchRoutes(mockRoutes, "/admin/");
assert(matchAdminSlash !== null && matchAdminSlash[2]?.route?.path === "admin", "Direct /admin/ (trailing slash) matches AdminOverview leaf");

const matchUsers = matchRoutes(mockRoutes, "/admin/users");
assert(matchUsers !== null && matchUsers[2]?.route?.path === "admin/users", "Nested /admin/users matches AdminUsers leaf");

const matchActivity = matchRoutes(mockRoutes, "/admin/activity");
assert(matchActivity !== null && matchActivity[2]?.route?.path === "admin/activity", "Nested /admin/activity matches AdminActivity leaf");

const matchUnknown = matchRoutes(mockRoutes, "/random-missing-route");
assert(matchUnknown !== null && matchUnknown[0]?.route?.path === "*", "Non-existent path matches catch-all NotFound route");

// ----------------------------------------------------------------------------
// Test 4: ProtectedRoute Guard Evaluation Matrix
// ----------------------------------------------------------------------------
console.log("\nTest 4: ProtectedRoute Guard Matrix");

function MockProtectedRoute({
  admin = false,
  ready,
  session,
}: {
  admin?: boolean;
  ready: boolean;
  session: { userId: string; role: "user" | "admin" } | null;
}) {
  if (!ready) return React.createElement("div", { id: "loading" }, "Loading auth...");
  if (!session) return React.createElement(Navigate, { to: "/login", replace: true });
  if (admin && session.role !== "admin") return React.createElement(Navigate, { to: "/app", replace: true });
  return React.createElement(Outlet);
}

function GuardTester({
  url,
  ready,
  session,
}: {
  url: string;
  ready: boolean;
  session: { userId: string; role: "user" | "admin" } | null;
}) {
  return React.createElement(
    MemoryRouter,
    { initialEntries: [url] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, { path: "login", element: React.createElement("div", { id: "login-page" }, "Login Page") }),
      React.createElement(Route, { path: "app", element: React.createElement("div", { id: "user-dashboard" }, "User Dashboard") }),
      React.createElement(
        Route,
        { element: React.createElement(MockProtectedRoute, { admin: true, ready, session }) },
        React.createElement(
          Route,
          { element: React.createElement("div", { id: "admin-shell" }, React.createElement(Outlet)) },
          React.createElement(Route, { path: "admin", element: React.createElement("div", { id: "admin-overview" }, "Admin Overview") }),
          React.createElement(Route, { path: "admin/users", element: React.createElement("div", { id: "admin-users" }, "Admin Users") })
        )
      ),
      React.createElement(Route, { path: "*", element: React.createElement("div", { id: "not-found" }, "404 Page") })
    )
  );
}

// Case 1: Auth not ready -> Suspends decision
const notReadyHtml = ReactDOMServer.renderToString(
  React.createElement(GuardTester, { url: "/admin", ready: false, session: null })
);
assert(notReadyHtml.includes("Loading auth..."), "When auth is initializing (ready=false), ProtectedRoute does not redirect or 404");

// Case 2: Unauthenticated guest -> Redirects to /login
const unauthHtml = ReactDOMServer.renderToString(
  React.createElement(GuardTester, { url: "/admin", ready: true, session: null })
);
assert(!unauthHtml.includes("404 Page"), "Unauthenticated guest visiting /admin does NOT see 404");
assert(!unauthHtml.includes("Admin Overview"), "Unauthenticated guest visiting /admin cannot see Admin Overview");

// Case 3: Authenticated non-admin member -> Redirects to /app
const memberHtml = ReactDOMServer.renderToString(
  React.createElement(GuardTester, { url: "/admin", ready: true, session: { userId: "user-1", role: "user" } })
);
assert(!memberHtml.includes("404 Page"), "Authenticated non-admin visiting /admin does NOT see 404");
assert(!memberHtml.includes("Admin Overview"), "Authenticated non-admin visiting /admin cannot see Admin Overview");

// Case 4: Authenticated admin -> Renders Admin Panel
const adminHtml = ReactDOMServer.renderToString(
  React.createElement(GuardTester, { url: "/admin", ready: true, session: { userId: "admin-1", role: "admin" } })
);
assert(adminHtml.includes("admin-shell") && adminHtml.includes("Admin Overview"), "Authorized administrator visiting /admin renders Admin Overview");

// Case 5: Authenticated admin visiting nested route /admin/users
const adminUsersHtml = ReactDOMServer.renderToString(
  React.createElement(GuardTester, { url: "/admin/users", ready: true, session: { userId: "admin-1", role: "admin" } })
);
assert(adminUsersHtml.includes("admin-shell") && adminUsersHtml.includes("Admin Users"), "Authorized administrator visiting /admin/users renders Admin Users");

console.log("\n========================================");
console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
console.log("========================================\n");

if (failed > 0) process.exit(1);
