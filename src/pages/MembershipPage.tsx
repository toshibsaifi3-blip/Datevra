import { Navigate } from "react-router-dom";
import { hasStoredAuthHint, useAuth } from "../context/AuthContext";
import MembershipPublic from "./public/MembershipPublic";
import Membership from "./user/Membership";

/**
 * /membership — dual-mode page.
 * Logged-out visitors see pricing; members and non-designated Admins in Member View see plan + upgrades.
 */
export default function MembershipPage() {
  const { user, isDesignatedAdminOnly, ready } = useAuth();
  if (!ready && hasStoredAuthHint()) return null;
  if (ready && isDesignatedAdminOnly) return <Navigate to="/admin" replace />;
  if (!user || isDesignatedAdminOnly) return <MembershipPublic />;
  return (
    <div className="pt-[72px]">
      <Membership />
    </div>
  );
}
