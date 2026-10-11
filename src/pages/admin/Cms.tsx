import { useEffect, useState } from "react";
import type { CmsPage } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Field, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate } from "./_util";

const PAGES = ["about", "safety"] as const;

export default function Cms() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [slug, setSlug] = useState<(typeof PAGES)[number]>("about");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: page, loading, error, refresh } = useAsync(
    (b) => b.getCmsPage(slug),
    [db, slug],
    null as CmsPage | null,
  );
  const { data: aboutPage } = useAsync((b) => b.getCmsPage("about"), [db], null as CmsPage | null);
  const { data: safetyPage } = useAsync((b) => b.getCmsPage("safety"), [db], null as CmsPage | null);

  useEffect(() => db.subscribe("cms", refresh), [db, refresh]);

  useEffect(() => {
    setTitle(page?.title ?? "");
    setBody(page?.body ?? "");
  }, [page, slug]);

  const titles: Record<string, string> = {
    about: aboutPage?.title ?? "about",
    safety: safetyPage?.title ?? "safety",
  };

  const save = async () => {
    if (!title.trim()) return toast("Title cannot be empty", "rose");
    if (!body.trim()) return toast("Body cannot be empty", "rose");
    try {
      await db.saveCmsPage({ slug, title: title.trim(), body: body.trim(), updatedAt: "" }, actor);
      refresh();
      toast(`“${slug}” published`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not publish", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-4xl mx-auto">
        <SectionHead
          kicker="Content"
          title="CMS Pages"
          sub="Edit public content pages. Legal pages (terms, privacy, refunds) live under Legal."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load page: {error}</p>}

        <div className="mt-8 flex gap-2">
          {PAGES.map((p) => (
            <button
              key={p}
              onClick={() => setSlug(p)}
              className={`rounded-xl px-5 py-2.5 text-sm transition-colors ${
                slug === p
                  ? "bg-rosegold/20 border border-rosegold/50 text-ivory"
                  : "glass text-ivory-dim hover:text-ivory"
              }`}
            >
              {titles[p]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="glass rounded-3xl p-6 mt-6 space-y-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="glass rounded-3xl p-6 mt-6 space-y-5">
            <Field label="Page slug">
              <input value={slug} disabled className={`${inputCls} opacity-60`} />
            </Field>
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Body" hint="Plain text for now — renders on the public page.">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={`${inputCls} min-h-64 leading-relaxed`}
              />
            </Field>
            <div className="flex items-center justify-between">
              <p className="text-xs text-mist">
                {page ? `Last updated ${fmtDate(page.updatedAt)}` : "Not yet published"}
              </p>
              <button onClick={save} className="btn-gold rounded-xl px-8 py-3 text-sm">
                Publish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
