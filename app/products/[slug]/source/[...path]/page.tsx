import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getProductDir, resolveProductSourcePath } from "@/lib/extractions";
import { readProductMdManifest, type ManifestSource } from "@/lib/sources";

export const dynamic = "force-dynamic";

/** URL segments use `__` as a stable token for `..` (browsers normalize literal `..` in paths). */
const UP_TOKEN = "__";
const SAFE_PATH_SEGMENT = /^(__|[a-z0-9._-]+)$/i;
const ALLOWED_EXT = /\.(md|txt)$/i;

function decodeUpToken(seg: string): string {
  return seg === UP_TOKEN ? ".." : seg;
}

function manifestPathToUrlSegments(p: string): string[] {
  return p.split("/").map((seg) => (seg === ".." ? UP_TOKEN : seg));
}

/**
 * Resolve a relative image src (from inside an MD file) against the MD's manifest path,
 * then turn it into an absolute URL that the `source-image/[...path]` route can serve.
 * Leaves absolute URLs (`http://`, `/foo`, `data:`) untouched.
 */
function rewriteRelativeImageUrl(src: string, slug: string, mdManifestPath: string): string {
  if (/^(https?:|data:|mailto:|\/)/i.test(src)) return src;
  const mdDir = mdManifestPath.split("/").slice(0, -1);
  const combined = [...mdDir, ...src.split("/")];
  const norm: string[] = [];
  for (const seg of combined) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && norm.length > 0 && norm[norm.length - 1] !== "..") {
      norm.pop();
    } else {
      norm.push(seg);
    }
  }
  const urlSegs = norm.map((s) => (s === ".." ? UP_TOKEN : encodeURIComponent(s)));
  return `/products/${slug}/source-image/${urlSegs.join("/")}`;
}

/** Rewrite both markdown image syntax `![](path)` and raw HTML `<img src="path">` in-body. */
function rewriteImageRefsInBody(body: string, slug: string, mdManifestPath: string): string {
  const rewritten = body.replace(
    /!\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g,
    (_m, alt, url, rest) => `![${alt}](${rewriteRelativeImageUrl(url, slug, mdManifestPath)}${rest})`
  );
  return rewritten.replace(
    /(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi,
    (_m, prefix, q, url) => `${prefix}${q}${rewriteRelativeImageUrl(url, slug, mdManifestPath)}${q}`
  );
}

function buildSiblingsFromManifest(
  manifest: ManifestSource[] | null,
  productDir: string,
  currentManifestPath: string
) {
  if (!manifest) return [];
  return manifest
    .filter((m) => m.local_extraction && ALLOWED_EXT.test(m.local_extraction))
    .map((m) => {
      const ext = m.local_extraction!;
      return {
        scope: m.scope,
        manifestPath: ext,
        urlSegments: manifestPathToUrlSegments(ext),
        label: ext,
        type: m.type,
        title: m.title,
        current: ext === currentManifestPath
      };
    })
    .sort((a, b) => {
      const order = { product: 0, line: 1, category: 2 };
      if (order[a.scope] !== order[b.scope]) return order[a.scope] - order[b.scope];
      return a.label.localeCompare(b.label);
    });
}

function listOwnSourceSiblings(productDir: string, currentSegments: string[]) {
  // Fallback when no MD manifest exists yet (pre-Phase-4A): list .md/.txt files in product's own source/.
  const sourceDir = path.join(productDir, "source");
  if (!fs.existsSync(sourceDir)) return [];
  return fs
    .readdirSync(sourceDir)
    .filter((n) => ALLOWED_EXT.test(n))
    .sort()
    .map((n) => ({
      scope: "product" as const,
      manifestPath: `source/${n}`,
      urlSegments: ["source", n],
      label: n,
      type: undefined,
      title: undefined,
      current: currentSegments.length === 1 && currentSegments[0] === n
        ? true
        : currentSegments.length === 2 && currentSegments[0] === "source" && currentSegments[1] === n
    }));
}

export default function SourceFilePage({
  params
}: {
  params: { slug: string; path: string[] };
}) {
  const segments = (params.path ?? []).map((s) => decodeURIComponent(s));
  if (segments.length === 0) notFound();
  for (const seg of segments) {
    if (!SAFE_PATH_SEGMENT.test(seg)) notFound();
  }
  const last = segments[segments.length - 1];
  if (!ALLOWED_EXT.test(last)) notFound();

  // Reconstruct the manifest-relative path; `__` segments map back to `..`.
  const manifestPath = segments.map(decodeUpToken).join("/");
  const fp = resolveProductSourcePath(params.slug, manifestPath);
  if (!fp) notFound();

  const productDir = getProductDir(params.slug);
  if (!productDir) notFound();

  const rawBody = fs.readFileSync(fp, "utf8");
  const isTxt = last.toLowerCase().endsWith(".txt");
  const body = isTxt ? rawBody : rewriteImageRefsInBody(rawBody, params.slug, manifestPath);
  const sizeKb = (fs.statSync(fp).size / 1024).toFixed(0);

  const manifest = readProductMdManifest(productDir, params.slug);
  const siblings = manifest
    ? buildSiblingsFromManifest(manifest, productDir, manifestPath)
    : listOwnSourceSiblings(productDir, segments);

  const scopeBadgeClass: Record<"product" | "line" | "category", string> = {
    product: "bg-emerald-500/15 text-emerald-200",
    line: "bg-sky-500/15 text-sky-200",
    category: "bg-amber-500/15 text-amber-200"
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-white/85">
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/products/${params.slug}`} className="text-white/60 hover:text-white">
          ← {params.slug}
        </Link>
        <span className="text-white/40">{sizeKb} KB</span>
      </div>

      <h1 className="mb-1 font-mono text-lg font-semibold">{manifestPath}</h1>

      <nav className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {siblings.map((s) => (
          <Link
            key={s.manifestPath}
            href={`/products/${params.slug}/source/${s.urlSegments.map(encodeURIComponent).join("/")}`}
            className={
              "flex items-center gap-1 rounded px-2 py-1 text-xs " +
              (s.current
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white")
            }
            title={s.title ?? s.label}
          >
            <span className={`rounded px-1 text-[10px] ${scopeBadgeClass[s.scope]}`}>{s.scope}</span>
            <span className="font-mono">{s.label}</span>
          </Link>
        ))}
      </nav>

      {isTxt ? (
        <pre className="whitespace-pre-wrap rounded bg-black/30 p-4 font-mono text-xs leading-relaxed text-white/80">
          {body}
        </pre>
      ) : (
        <article className="md-source">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {body}
          </ReactMarkdown>
        </article>
      )}

      <style>{`
        .md-source { line-height: 1.55; }
        .md-source h1 { font-size: 1.4rem; font-weight: 600; margin: 1.6rem 0 0.6rem; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 0.3rem; }
        .md-source h2 { font-size: 1.15rem; font-weight: 600; margin: 1.3rem 0 0.5rem; }
        .md-source h3 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: rgba(255,255,255,0.85); }
        .md-source p { margin: 0.5rem 0; }
        .md-source ul, .md-source ol { margin: 0.5rem 0; padding-left: 1.4rem; }
        .md-source li { margin: 0.15rem 0; }
        .md-source code { background: rgba(255,255,255,0.08); padding: 0.05rem 0.3rem; border-radius: 3px; font-size: 0.85em; }
        .md-source pre { background: rgba(0,0,0,0.35); padding: 0.6rem; border-radius: 4px; overflow-x: auto; }
        .md-source blockquote { border-left: 3px solid rgba(255,255,255,0.25); padding: 0.2rem 0.8rem; margin: 0.6rem 0; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.03); }
        .md-source table { border-collapse: collapse; margin: 0.7rem 0; font-size: 0.85em; }
        .md-source th, .md-source td { border: 1px solid rgba(255,255,255,0.15); padding: 0.3rem 0.5rem; text-align: left; vertical-align: top; }
        .md-source th { background: rgba(255,255,255,0.06); font-weight: 600; }
        .md-source hr { border: none; border-top: 1px dashed rgba(255,255,255,0.15); margin: 1.5rem 0; }
        .md-source a { color: #7dd3fc; text-decoration: underline; }
        .md-source img { max-width: 100%; }
      `}</style>
    </div>
  );
}
