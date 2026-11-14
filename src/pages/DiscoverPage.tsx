import { Navigate } from "react-router-dom";
import { hasStoredAuthHint, useAuth } from "../context/AuthContext";
import DiscoverPublic from "./public/DiscoverPublic";
import Discover from "./user/Discover";

/**
 * /discover — dual-mode page.
 * Logged-out visitors see the teaser; members and non-designated Admins in Member View get the full swipe/match interface.
 */
export default function DiscoverPage() {
  const { user, isDesignatedAdminOnly, ready } = useAuth();
  if (!ready && hasStoredAuthHint()) return null;
  if (ready && isDesignatedAdminOnly) return <Navigate to="/admin" replace />;
  if (!user || isDesignatedAdminOnly) return <DiscoverPublic />;
  return (
    <div className="pt-[72px] flex-1 min-h-0 flex flex-col lg:block">
      <Discover />
    </div>
  );
}
