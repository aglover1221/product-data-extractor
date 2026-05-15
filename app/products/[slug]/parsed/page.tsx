import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDir, getProductSourceDir } from "@/lib/extractions";
import { formatBytes, readProductMdManifest, type ManifestSource } from "@/lib/sources";

export const dynamic = "force-dynamic";

type Row = {
  scope: "product" | "line" | "category";
  label: string;
  manifestPath: string;
  urlSegments: string[];
  size: number;
  type?: string;
  title?: string;
  resolved: boolean;
};

const ALLOWED_EXT = /\.(md|txt)$/i;

function statSize(fp: string | undefined): number {
  if (!fp) return 0;
  try {
    return fs.statSync(fp).size;
  } catch {
    return 0;
  }
}

/** Map a manifest path (e.g. "../source/foo.md") to URL segments using `__` for `..`. */
function manifestPathToUrlSegments(p: string): string[] {
  return p.split("/").map((seg) => (seg === ".." ? "__" : seg));
}

function rowsFromManifest(manifest: ManifestSource[]): Row[] {
  return manifest
    .filter((m) => m.local_extraction && ALLOWED_EXT.test(m.local_extraction))
    .map((m): Row => {
      const ext = m.local_extraction!;
      return {
        scope: m.scope,
        label: ext,
        manifestPath: ext,
        urlSegments: manifestPathToUrlSegments(ext),
        size: statSize(m.resolved_extraction_path),
        type: m.type,
        title: m.title,
        resolved: !!m.resolved_extraction_path
      };
    });
}

function rowsFromOwnSourceDir(sourceDir: string): Row[] {
  return fs
    .readdirSync(sourceDir)
    .filter((n) => ALLOWED_EXT.test(n))
    .sort()
    .map((name): Row => {
      const fp = path.join(sourceDir, name);
      return {
        scope: "product",
        label: name,
        manifestPath: `source/${name}`,
        urlSegments: ["source", name],
        size: statSize(fp),
        resolved: true
      };
    });
}

export default function ParsedSourcesPage({ params }: { params: { slug: string } }) {
  const productDir = getProductDir(params.slug);
  if (!productDir) notFound();

  const manifest = readProductMdManifest(productDir, params.slug);
  let rows: Row[];
  if (manifest && manifest.length > 0) {
    rows = rowsFromManifest(manifest).sort((a, b) => {
      const order = { product: 0, line: 1, category: 2 } as const;
      if (order[a.scope] !== order[b.scope]) return order[a.scope] - order[b.scope];
      return a.label.localeCompare(b.label);
    });
  } else {
    // Pre-Phase-4A fallback: no `{slug}.md` yet — list the product's own source/ contents.
    const sourceDir = getProductSourceDir(params.slug);
    rows = sourceDir ? rowsFromOwnSourceDir(sourceDir) : [];
  }

  const scopeBadgeClass: Record<"product" | "line" | "category", string> = {
    product: "bg-emerald-500/15 text-emerald-200",
    line: "bg-sky-500/15 text-sky-200",
    category: "bg-amber-500/15 text-amber-200"
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-[12px] text-white/50">
          ← portfolio
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          parsed sources · /{params.slug}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{params.slug}</h1>
        <div className="flex gap-3 text-[12px] mt-2">
          <Link href={`/products/${params.slug}/raw`} className="text-white/60">
            raw sources →
          </Link>
          <Link href={`/products/${params.slug}`} className="text-white/60">
            extraction →
          </Link>
        </div>
        {!manifest && (
          <div className="mt-3 rounded border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-200/80">
            No <code className="font-mono">{params.slug}.md</code> manifest on disk yet — listing the product&apos;s own
            <code className="font-mono"> source/</code> contents directly. Up-scope (line / category) sources will appear once Phase 4A backfills the manifest.
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="panel text-sm text-white/60">
          No parsed markdown sidecars resolvable from the manifest or this product&apos;s source directory.
        </div>
      ) : (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-20">Scope</th>
                <th>File</th>
                <th>Type</th>
                <th className="text-right">Size</th>
                <th className="w-24">View</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.manifestPath} className="hover:bg-white/[0.04]">
                  <td>
                    <span className={`rounded px-2 py-0.5 text-[10px] ${scopeBadgeClass[r.scope]}`}>
                      {r.scope}
                    </span>
                  </td>
                  <td className="font-mono text-[12px]" title={r.title ?? ""}>
                    {r.label}
                    {!r.resolved && (
                      <span className="ml-2 text-[10px] text-rose-300/80">unresolved</span>
                    )}
                  </td>
                  <td className="text-[12px] text-white/60">{r.type ?? "—"}</td>
                  <td className="text-right text-[12px] text-white/60">{formatBytes(r.size)}</td>
                  <td>
                    {r.resolved ? (
                      <Link
                        href={`/products/${params.slug}/source/${r.urlSegments.map(encodeURIComponent).join("/")}`}
                        className="text-[11px] text-white/80 hover:text-white"
                      >
                        view →
                      </Link>
                    ) : (
                      <span className="text-[11px] text-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
