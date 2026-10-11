import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { motion } from "framer-motion";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider, Logo } from "./components/ui";
import {
  PublicLayout,
  ProtectedRoute,
  UserShell,
  AdminShell,
  ScrollToTop,
  SplashLayout,
} from "./components/layout";

/* ---------- lazy pages ---------- */
const Home = lazy(() => import("./pages/public/Home"));
const HowItWorks = lazy(() => import("./pages/public/HowItWorks"));
const CafeDetail = lazy(() => import("./pages/public/CafeDetail"));
const About = lazy(() => import("./pages/public/About"));
const Safety = lazy(() => import("./pages/public/Safety"));
const Faqs = lazy(() => import("./pages/public/Faqs"));
const Contact = lazy(() => import("./pages/public/Contact"));
const Legal = lazy(() => import("./pages/public/Legal"));
const Login = lazy(() => import("./pages/public/Login"));
const Register = lazy(() => import("./pages/public/Register"));
const Forgot = lazy(() => import("./pages/public/Forgot"));

/* Dual-mode pages: marketing for visitors, full functionality for members */
const DiscoverPage = lazy(() => import("./pages/DiscoverPage"));
const MembershipPage = lazy(() => import("./pages/MembershipPage"));
const ExperiencesPage = lazy(() => import("./pages/ExperiencesPage"));
const CafesPage = lazy(() => import("./pages/CafesPage"));

const Dashboard = lazy(() => import("./pages/user/Dashboard"));
const Profile = lazy(() => import("./pages/user/Profile"));
const Likes = lazy(() => import("./pages/user/Likes"));
const Matches = lazy(() => import("./pages/user/Matches"));
const MyPasses = lazy(() => import("./pages/user/MyPasses"));
const Chat = lazy(() => import("./pages/user/Chat"));
const Notifications = lazy(() => import("./pages/user/Notifications"));
const Settings = lazy(() => import("./pages/user/Settings"));
const Privacy = lazy(() => import("./pages/user/Privacy"));
const Blocked = lazy(() => import("./pages/user/Blocked"));

const AdminOverview = lazy(() => import("./pages/admin/Overview"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminVerification = lazy(() => import("./pages/admin/Verification"));
const AdminReports = lazy(() => import("./pages/admin/Reports"));
const AdminMatchmaking = lazy(() => import("./pages/admin/Matchmaking"));
const AdminMemberships = lazy(() => import("./pages/admin/Memberships"));
const AdminPayments = lazy(() => import("./pages/admin/Payments"));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics"));
const AdminInvestors = lazy(() => import("./pages/admin/Investors"));
const AdminCommissions = lazy(() => import("./pages/admin/Commissions"));
const AdminApplications = lazy(() => import("./pages/admin/Applications"));
const AdminBookings = lazy(() => import("./pages/admin/Bookings"));
const AdminCafes = lazy(() => import("./pages/admin/Cafes"));
const AdminPasses = lazy(() => import("./pages/admin/Passes"));
const AdminPartnerships = lazy(() => import("./pages/admin/Partnerships"));
const AdminNotifications = lazy(() => import("./pages/admin/Notifications"));
const AdminCms = lazy(() => import("./pages/admin/Cms"));
const AdminLegal = lazy(() => import("./pages/admin/Legal"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const AdminActivity = lazy(() => import("./pages/admin/Activity"));

const NotFound = lazy(() => import("./pages/public/NotFound"));

export function BrandedLoader() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="animate-glow-pulse"
      >
        <Logo size={72} withWordmark={false} />
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="font-display text-2xl tracking-[0.3em] text-shimmer"
      >
        DATEVRA
      </motion.p>
      <div className="w-40 h-[3px] rounded-full overflow-hidden bg-white/5">
        <motion.div
          className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-rosegold to-transparent"
          animate={{ x: ["-100%", "220%"] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}

function Splash({ children }: { children: ReactNode }) {
  return <SplashLayout>{children}</SplashLayout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Suspense fallback={<BrandedLoader />}>
            <Routes>
              {/* public */}
              <Route element={<PublicLayout />}>
                <Route index element={<Home />} />
                <Route path="discover" element={<DiscoverPage />} />
                <Route path="how-it-works" element={<HowItWorks />} />
                <Route path="membership" element={<MembershipPage />} />
                <Route path="experiences" element={<ExperiencesPage />} />
                <Route path="cafes" element={<CafesPage />} />
                <Route path="cafes/:id" element={<CafeDetail />} />
                <Route path="about" element={<About />} />
                <Route path="safety" element={<Safety />} />
                <Route path="faqs" element={<Faqs />} />
                <Route path="contact" element={<Contact />} />
                <Route path="terms" element={<Legal slug="terms" />} />
                <Route path="privacy" element={<Legal slug="privacy" />} />
                <Route path="refund" element={<Legal slug="refund" />} />
              </Route>
              <Route path="login" element={<Splash><Login /></Splash>} />
              <Route path="register" element={<Splash><Register /></Splash>} />
              <Route path="forgot" element={<Splash><Forgot /></Splash>} />

              {/* member */}
              <Route element={<ProtectedRoute />}>
                <Route element={<UserShell />}>
                  <Route path="app" element={<Dashboard />} />
                  <Route path="likes" element={<Likes />} />
                  <Route path="matches" element={<Matches />} />
                  <Route path="passes" element={<MyPasses />} />
                  <Route path="chat" element={<Chat />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="privacy" element={<Privacy />} />
                  <Route path="blocked" element={<Blocked />} />
                </Route>
              </Route>

              {/* admin */}
              <Route element={<ProtectedRoute admin />}>
                <Route element={<AdminShell />}>
                  <Route path="admin" element={<AdminOverview />} />
                  <Route path="admin/users" element={<AdminUsers />} />
                  <Route path="admin/verification" element={<AdminVerification />} />
                  <Route path="admin/reports" element={<AdminReports />} />
                  <Route path="admin/matchmaking" element={<AdminMatchmaking />} />
                  <Route path="admin/memberships" element={<AdminMemberships />} />
                  <Route path="admin/payments" element={<AdminPayments />} />
                  <Route path="admin/analytics" element={<AdminAnalytics />} />
                  <Route path="admin/investors" element={<AdminInvestors />} />
                  <Route path="admin/commissions" element={<AdminCommissions />} />
                  <Route path="admin/applications" element={<AdminApplications />} />
                  <Route path="admin/bookings" element={<AdminBookings />} />
                  <Route path="admin/cafes" element={<AdminCafes />} />
                  <Route path="admin/passes" element={<AdminPasses />} />
                  <Route path="admin/partnerships" element={<AdminPartnerships />} />
                  <Route path="admin/notifications" element={<AdminNotifications />} />
                  <Route path="admin/cms" element={<AdminCms />} />
                  <Route path="admin/legal" element={<AdminLegal />} />
                  <Route path="admin/settings" element={<AdminSettings />} />
                  <Route path="admin/activity" element={<AdminActivity />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
