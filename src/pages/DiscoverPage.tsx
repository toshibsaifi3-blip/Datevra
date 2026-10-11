import { useAuth } from "../context/AuthContext";
import DiscoverPublic from "./public/DiscoverPublic";
import Discover from "./user/Discover";

/**
 * /discover — dual-mode page.
 * Logged-out visitors see the teaser; members get the full swipe/match interface.
 */
export default function DiscoverPage() {
  const { user } = useAuth();
  if (!user) return <DiscoverPublic />;
  return (
    <div className="pt-[72px]">
      <Discover />
    </div>
  );
}
