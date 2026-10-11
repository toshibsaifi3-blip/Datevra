import { useEffect, useState } from "react";
import type { CmsPage } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Field, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate } from "./_util";

const DOCS = [
  { slug: "legal-terms", label: "Terms of Service" },
  { slug: "legal-privacy", label: "Privacy Policy" },
  { slug: "legal-refund", label: "Refund Policy" },
] as const;

export default function Legal() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [slug, setSlug] = useState<string>("legal-terms");
  const [title, setTitle] = useState("Terms of Service");
  const [body, setBody] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: page, loading, error, refresh } = useAsync(
    (b) => b.getCmsPage(slug),
    [db, slug],
    null as CmsPage | null,
  );

  useEffect(() => db.subscribe("cms", refresh), [db, refresh]);

  useEffect(() => {
    setTitle(page?.title ?? DOCS.find((d) => d.slug === slug)?.label ?? slug);
    setBody(page?.body ?? "");
  }, [page, slug]);

  const save = async () => {
    if (!title.trim()) return toast("Title cannot be empty", "rose");
    if (!body.trim()) return toast("Body cannot be empty", "rose");
    try {
      await db.saveCmsPage({ slug, title: title.trim(), body: body.trim(), updatedAt: "" }, actor);
      refresh();
      toast(`${DOCS.find((d) => d.slug === slug)?.label} updated`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not publish", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-4xl mx-auto">
        <SectionHead
          kicker="Compliance"
          title="Legal Pages"
          sub="Terms, privacy and refund policy as shown on the public site. Keep them current and review with counsel."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load document: {error}</p>}

        <div className="mt-8 flex gap-2 flex-wrap">
          {DOCS.map((d) => (
            <button
              key={d.slug}
              onClick={() => setSlug(d.slug)}
              className={`rounded-xl px-5 py-2.5 text-sm transition-colors ${
                slug === d.slug
                  ? "bg-rosegold/20 border border-rosegold/50 text-ivory"
                  : "glass text-ivory-dim hover:text-ivory"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="glass rounded-3xl p-6 mt-6 space-y-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-72" />
          </div>
        ) : (
          <div className="glass rounded-3xl p-6 mt-6 space-y-5">
            <Field label="Document title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </Field>
            <Field
              label="Content"
              hint="Plain text. Make membership and experience terms explicit: payment never guarantees a match, date, selection or romantic outcome."
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className={`${inputCls} min-h-72 leading-relaxed`}
                placeholder="Write the legal text here…"
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
