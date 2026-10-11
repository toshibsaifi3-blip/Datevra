import { useAuth } from "../context/AuthContext";
import MembershipPublic from "./public/MembershipPublic";
import Membership from "./user/Membership";

/**
 * /membership — dual-mode page.
 * Logged-out visitors see pricing; members see their plan + upgrades.
 */
export default function MembershipPage() {
  const { user } = useAuth();
  if (!user) return <MembershipPublic />;
  return (
    <div className="pt-[72px]">
      <Membership />
    </div>
  );
}
