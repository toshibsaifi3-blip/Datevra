import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useBackend } from "../lib/data";
import { useToast } from "./ui";
import { MAX_PHOTOS, validatePhotoFile } from "../lib/photos";

/**
 * Profile photo manager: upload, preview, reorder (main photo), delete.
 * Self-contained: reads the signed-in user's photos, persists changes via
 * updateUser, and refreshes auth state so discovery/matching pick up new
 * photos immediately.
 */

interface Pending {
  id: string;
  preview: string;
  progress: number;
}

export default function PhotoManager() {
  const { user, refresh } = useAuth();
  const db = useBackend();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<string[]>(user?.photos ?? []);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ref mirror so parallel uploads each append to the latest list.
  const photosRef = useRef<string[]>(user?.photos ?? []);
  useEffect(() => {
    photosRef.current = user?.photos ?? [];
    setPhotos(user?.photos ?? []);
  }, [user?.photos]);

  if (!user) return null;

  const savePhotos = async (next: string[]) => {
    photosRef.current = next;
    setPhotos(next);
    await db.updateUser(user.id, { photos: next });
    await refresh();
  };

  const handleFiles = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, MAX_PHOTOS - photos.length - pending.length);
    if (chosen.length === 0) {
      setError(`You can have up to ${MAX_PHOTOS} photos. Delete one to add another.`);
      return;
    }
    for (const f of chosen) {
      const problem = validatePhotoFile(f);
      if (problem) {
        setError(problem);
        toast(problem, "rose");
        return;
      }
    }
    // Start uploads in parallel; each tile tracks its own progress.
    const items: Pending[] = chosen.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      preview: URL.createObjectURL(f),
      progress: 0,
    }));
    setPending((p) => [...p, ...items]);

    await Promise.all(
      chosen.map(async (file, i) => {
        const item = items[i];
        try {
          const url = await db.uploadPhoto(user.id, file, (pct) =>
            setPending((p) => p.map((x) => (x.id === item.id ? { ...x, progress: pct } : x))),
          );
          URL.revokeObjectURL(item.preview);
          setPending((p) => p.filter((x) => x.id !== item.id));
          await savePhotos([...photosRef.current, url]);
        } catch (e) {
          URL.revokeObjectURL(item.preview);
          setPending((p) => p.filter((x) => x.id !== item.id));
          const msg = e instanceof Error ? e.message : "Couldn't upload that photo.";
          setError(msg);
          toast(msg, "rose");
        }
      }),
    );
  };

  const removePhoto = async (photoUrl: string) => {
    if (confirmDelete !== photoUrl) {
      setConfirmDelete(photoUrl);
      window.setTimeout(() => setConfirmDelete((c) => (c === photoUrl ? null : c)), 4000);
      return;
    }
    setConfirmDelete(null);
    setBusy(true);
    try {
      await db.deletePhoto(user.id, photoUrl);
      await savePhotos(photosRef.current.filter((p) => p !== photoUrl));
      toast("Photo deleted.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't delete that photo.";
      setError(msg);
      toast(msg, "rose");
    } finally {
      setBusy(false);
    }
  };

  const makeMain = async (photoUrl: string) => {
    if (photosRef.current[0] === photoUrl) return;
    await savePhotos([photoUrl, ...photosRef.current.filter((p) => p !== photoUrl)]);
    toast("Main photo updated.");
  };

  const slotsLeft = MAX_PHOTOS - photos.length - pending.length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display text-xl text-ivory">Photos</h2>
        <span className="text-xs text-mist">
          {photos.length}/{MAX_PHOTOS} · first photo is your main one
        </span>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 rounded-2xl border border-rose/40 bg-rose/10 px-4 py-2.5 text-sm text-rose"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-3">
        {photos.map((url, i) => (
          <motion.div
            key={url}
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5 group"
          >
            <img src={url} alt={`Profile photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
            {i === 0 && (
              <span className="absolute left-2 top-2 rounded-full bg-gold px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-midnight">
                Main
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
              {i !== 0 ? (
                <button
                  onClick={() => void makeMain(url)}
                  disabled={busy}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-[0.65rem] font-medium text-ivory backdrop-blur-sm hover:bg-white/25 disabled:opacity-50"
                >
                  Make main
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => void removePhoto(url)}
                disabled={busy}
                aria-label={confirmDelete === url ? "Confirm delete photo" : "Delete photo"}
                className={`rounded-full px-2.5 py-1 text-[0.65rem] font-medium backdrop-blur-sm transition-colors ${
                  confirmDelete === url
                    ? "bg-rose text-white"
                    : "bg-white/15 text-ivory hover:bg-rose/70 hover:text-white"
                } disabled:opacity-50`}
              >
                {confirmDelete === url ? "Tap again to delete" : "Delete"}
              </button>
            </div>
          </motion.div>
        ))}

        {pending.map((p) => (
          <div
            key={p.id}
            className="relative aspect-square overflow-hidden rounded-2xl border border-gold/40 bg-white/5"
          >
            <img src={p.preview} alt="Uploading photo" className="h-full w-full object-cover opacity-60" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
              <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-white/20">
                <motion.div
                  className="h-full rounded-full bg-gold"
                  animate={{ width: `${p.progress}%` }}
                  transition={{ ease: "easeOut", duration: 0.2 }}
                />
              </div>
              <span className="text-xs text-ivory">{p.progress}%</span>
            </div>
          </div>
        ))}

        {slotsLeft > 0 && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/20 text-mist transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
            aria-label="Add photos"
          >
            <span className="text-3xl leading-none">+</span>
            <span className="px-2 text-center text-[0.7rem] leading-tight">Add photo</span>
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="mt-3 text-xs text-mist">
        JPG, PNG, or WebP · up to 5 MB each · up to {MAX_PHOTOS} photos. Photos are visible to other members in discovery.
      </p>
    </div>
  );
}
