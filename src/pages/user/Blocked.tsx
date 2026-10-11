import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Avatar, EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import { timeAgo, useDbRefresh } from "./shared";
import type { Block, UserProfile } from "../../lib/types";

interface BlockRow {
  block: Block;
  profile: UserProfile;
}

export default function Blocked() {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const tick = useDbRefresh("blocks");

  const {
    data: blocks,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<BlockRow[]> => {
      if (!user) return [];
      const bl = await b.blockedBy(user.id);
      const profs = await Promise.all(
        bl.map((x) => b.getUser(x.blockedId)),
      );
      const rows: BlockRow[] = [];
      bl.forEach((block, i) => {
        const profile = profs[i];
        if (profile) rows.push({ block, profile });
      });
      return rows;
    },
    [user?.id, tick],
    [] as BlockRow[],
  );

  if (!user) return null;
  const me = user;

  const doUnblock = async (profileId: string, name: string) => {
    try {
      await db.unblockUser(me.id, profileId);
      refresh();
      toast(`${name} has been unblocked.`);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't unblock right now.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Privacy</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-2">Blocked users</h1>
        <p className="text-sm text-mist mb-8">
          Blocked people can't see your profile, message you, or appear in your discovery.
          Unblocking restores visibility — it doesn't restore past matches.
        </p>
      </Reveal>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load blocked users: {error}</p>
      ) : blocks.length === 0 ? (
        <EmptyState
          title="Nobody blocked"
          body="Your block list is empty. If someone makes you uncomfortable, you can block them from their profile or any conversation."
          action={
            <Link to="/privacy" className="btn-ghost rounded-full px-6 py-2.5 text-sm inline-block">
              Back to Privacy
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {blocks.map(({ block, profile }) => (
            <Reveal key={block.blockedId}>
              <div className="glass rounded-2xl p-4 flex items-center gap-4">
                <Avatar name={profile.firstName} size={52} />
                <div className="flex-1 min-w-0">
                  <p className="text-ivory font-medium">
                    {profile.firstName}, {profile.age}
                  </p>
                  <p className="text-xs text-mist">Blocked {timeAgo(block.createdAt)}</p>
                </div>
                <button
                  onClick={() => doUnblock(profile.id, profile.firstName)}
                  className="btn-ghost rounded-full px-5 py-2 text-sm"
                >
                  Unblock
                </button>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
