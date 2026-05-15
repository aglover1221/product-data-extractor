import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductDir, getProductSourceDir } from "@/lib/extractions";
import {
  formatBytes,
  readProductMdManifest,
  readSourcesManifest,
  type ManifestSource
} from "@/lib/sources";

export const dynamic = "force-dynamic";

type Row = {
  scope: "product" | "line" | "category";
  label: string;
  manifestPath: string;
  urlSegments: string[];
  size: number;
  type?: string;
  url?: string | null;
  resolved: boolean;
};

const ALLOWED_EXT = /\.pdf$/i;

function statSize(fp: string | undefined): number {
  if (!fp) return 0;
  try {
    return fs.statSync(fp).size;
  } catch {
    return 0;
  }
}

/** Map a manifest path (e.g. "../source/foo.pdf") to URL segments using `__` for `..`. */
function manifestPathToUrlSegments(p: string): string[] {
  return p.split("/").map((seg) => (seg === ".." ? "__" : seg));
}

function rowsFromManifest(manifest: ManifestSource[]): Row[] {
  return manifest
    .filter((m) => ALLOWED_EXT.test(m.local))
    .map((m): Row => ({
      scope: m.scope,
      label: m.local,
      manifestPath: m.local,
      urlSegments: manifestPathToUrlSegments(m.local),
      size: statSize(m.resolved_path),
      type: m.type,
      url: m.url ?? null,
      resolved: !!m.resolved_path
    }));
}

function rowsFromOwnSourceDir(productDir: string, sourceDir: string): Row[] {
  const yamlManifest = readSourcesManifest(productDir);
  const urlMap = new Map<string, string>();
  for (const row of yamlManifest?.sources ?? []) {
    if (row.filename && row.url) urlMap.set(row.filename, row.url);
  }
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
        url: urlMap.get(name) ?? null,
        resolved: true
      };
    });
}

export default function RawSourcesPage({ params }: { params: { slug: string } }) {
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
    const sourceDir = getProductSourceDir(params.slug);
    rows = sourceDir ? rowsFromOwnSourceDir(productDir, sourceDir) : [];
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
          raw sources · /{params.slug}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{params.slug}</h1>
        <div className="flex gap-3 text-[12px] mt-2">
          <Link href={`/products/${params.slug}/parsed`} className="text-white/60">
            parsed sources →
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
        <div className="panel text-sm text-white/60">No PDFs resolvable from the manifest or this product&apos;s source directory.</div>
      ) : (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-20">Scope</th>
                <th>File</th>
                <th>Type</th>
                <th className="text-right">Size</th>
                <th className="w-24">Local</th>
                <th>Remote</th>
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
                  <td className="font-mono text-[12px]">
                    {r.label}
                    {!r.resolved && (
                      <span className="ml-2 text-[10px] text-rose-300/80">unresolved</span>
                    )}
                  </td>
                  <td className="text-[12px] text-white/60">{r.type ?? "—"}</td>
                  <td className="text-right text-[12px] text-white/60">{formatBytes(r.size)}</td>
                  <td>
                    {r.resolved ? (
                      <a
                        href={`/products/${params.slug}/raw/${r.urlSegments.map(encodeURIComponent).join("/")}`}
                        target="_blank"
                        rel="noopener"
                        className="text-[11px] text-white/80 hover:text-white"
                      >
                        open ↗
                      </a>
                    ) : (
                      <span className="text-[11px] text-white/30">—</span>
                    )}
                  </td>
                  <td className="text-[11px]">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300/80 hover:text-blue-300 break-all"
                        title={r.url}
                      >
                        {r.url.replace(/^https?:\/\//, "").slice(0, 80)}
                        {r.url.length > 80 ? "…" : ""} ↗
                      </a>
                    ) : (
                      <span className="text-white/30">—</span>
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
