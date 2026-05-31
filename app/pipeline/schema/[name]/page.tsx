/**
 * /pipeline/schema/[name]
 *
 * Schema detail. Shows current MD content (rendered) + frontmatter summary +
 * Edit button + version history sidebar. If `?saved=<version>` is present in
 * the URL, displays a post-save banner with a "Re-extract affected products"
 * CTA that hands off to Wave 2's /pipeline/extract page.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import "../md-preview.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  findSchemaFile,
  readSchemaContent,
} from "@/lib/pipeline/schemas-fs";
import {
  listVersions,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";
import { parseMarkdown } from "@/lib/safe-matter";

export const dynamic = "force-dynamic";

type Search = { saved?: string };

export default function SchemaDetailPage({
  params,
  searchParams,
}: {
  params: { name: string };
  searchParams: Search;
}) {
  seedFromFilesystemIfEmpty();
  const rec = findSchemaFile(params.name);
  if (!rec) notFound();

  const content = readSchemaContent(params.name) ?? "";
  const { data: fm } = parseMarkdown(content);
  const versions = listVersions(params.name);
  const head = versions[0];
  const savedVersion = searchParams.saved ?? null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/pipeline/schema" className="text-[12px] text-white/50">
          ← schemas
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          schema · {rec.is_overlay ? "overlay" : "base"}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold mt-1">
            {fm.name ?? rec.name}
          </h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/pipeline/schema/${rec.name}/history`}
              className="rounded border border-white/10 bg-white/[0.02] px-3 py-1 text-[12px] text-white/80 hover:bg-white/5"
            >
              History ({versions.length})
            </Link>
            <Link
              href={`/pipeline/schema/${rec.name}/edit`}
              className="rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[12px] text-emerald-200 hover:bg-emerald-500/20"
            >
              Edit
            </Link>
          </div>
        </div>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          {rec.rel_path} · v {head?.version ?? rec.version}
          {fm.last_updated && <> · last_updated {String(fm.last_updated)}</>}
          {fm.parent && <> · parent {String(fm.parent)}</>}
        </div>
        {fm.description && (
          <p className="text-sm text-white/70 mt-2 max-w-[1000px]">
            {String(fm.description)}
          </p>
        )}
      </div>

      {savedVersion && (
        <div className="rounded border border-emerald-400/40 bg-emerald-500/10 p-4 text-[12px] text-emerald-100">
          <div className="font-medium mb-1">
            Saved as <span className="font-mono">{savedVersion}</span>
          </div>
          <div className="text-white/70 mb-3">
            File written. Affected products may need re-extraction against the
            new version.
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/pipeline/extract?category=${encodeURIComponent(
                rec.name,
              )}&schema_version=${encodeURIComponent(savedVersion)}`}
              className="rounded border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-[12px] text-emerald-100 hover:bg-emerald-500/30"
            >
              Re-extract affected products →
            </Link>
            <Link
              href={`/pipeline/schema/${rec.name}/history`}
              className="rounded border border-white/15 bg-white/5 px-3 py-1 text-[12px] text-white/80 hover:bg-white/10"
            >
              View diff vs prior
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
        {/* Rendered MD */}
        <section className="panel overflow-auto">
          <div className="panel-title">Rendered</div>
          <div className="md-preview text-[13px] text-white/80 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="panel">
            <div className="panel-title">Frontmatter</div>
            <dl className="kv">
              {Object.entries(fm).map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
            </dl>
          </section>

          <section className="panel">
            <div className="panel-title">Version history</div>
            {versions.length === 0 ? (
              <div className="text-[12px] text-white/50">
                No history yet — first save will create v1.
              </div>
            ) : (
              <ul className="text-[12px] space-y-1">
                {versions.slice(0, 12).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono">{v.version}</span>
                    <span className="text-white/40 text-[11px]">
                      {new Date(v.created_at).toISOString().slice(0, 10)}
                    </span>
                    <StatusBadge value={v.status} />
                  </li>
                ))}
                {versions.length > 12 && (
                  <li className="text-[11px] text-white/40 pt-1">
                    + {versions.length - 12} older
                  </li>
                )}
              </ul>
            )}
            <div className="mt-3">
              <Link
                href={`/pipeline/schema/${rec.name}/history`}
                className="text-[11px] text-blue-300/80"
              >
                Full history & diff →
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  if (v == null) return null;
  let display: string;
  if (typeof v === "string") display = v;
  else display = JSON.stringify(v);
  return (
    <>
      <dt>{k}</dt>
      <dd className="break-words whitespace-pre-wrap">{display}</dd>
    </>
  );
}

function StatusBadge({ value }: { value: string }) {
  if (value === "active") {
    return <span className="pill bg-emerald-500/15 text-emerald-300">active</span>;
  }
  if (value === "draft") {
    return <span className="pill bg-amber-500/15 text-amber-300">draft</span>;
  }
  return <span className="pill pill-off">{value}</span>;
}
