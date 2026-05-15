import Link from "next/link";
import { notFound } from "next/navigation";
import {
  listProductSourcesWithStatus,
  manifestMatchForSidecar,
  type SourceWithStatus,
} from "@/lib/pipeline/parse-status";
import { formatBytes } from "@/lib/sources";
import RunButton from "./_run-button";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-sky-500/15 text-sky-200",
  running: "bg-amber-500/15 text-amber-200",
  completed: "bg-emerald-500/15 text-emerald-200",
  failed: "bg-rose-500/15 text-rose-200",
  none: "bg-white/5 text-white/40",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`pill ${STATUS_COLOR[status] ?? "bg-white/5 text-white/40"}`}>{status}</span>;
}

function ValidationCells({ src }: { src: SourceWithStatus }) {
  const v = (src.latestRun?.validation ?? null) as
    | {
        pageCount?: number;
        tableCount?: number;
        anchorCount?: number;
        textDensity?: number;
        warnings?: string[];
        charCount?: number;
      }
    | null;
  if (!v) {
    return (
      <td className="text-[11px] text-white/30">
        {src.hasSidecar ? "(sidecar exists; no validation row)" : "—"}
      </td>
    );
  }
  return (
    <td className="text-[11px] text-white/70">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span title="pages">p={v.pageCount ?? "?"}</span>
        <span title="tables">t={v.tableCount ?? "?"}</span>
        <span title="anchors">a={v.anchorCount ?? "?"}</span>
        <span title="chars/page">d={v.textDensity ?? "?"}</span>
      </div>
      {v.warnings && v.warnings.length > 0 && (
        <div className="text-rose-300/80 text-[10px] mt-1">{v.warnings.join("; ")}</div>
      )}
    </td>
  );
}

export default function ProductParsePage({ params }: { params: { productSlug: string } }) {
  const sources = listProductSourcesWithStatus(params.productSlug);
  if (sources.length === 0) {
    // Could be a slug typo; could also be a product with all sources at line/category scope.
    // We don't merge those here (the per-product page is purely about own-scope PDFs).
    // Render a minimal page so the user sees the absence rather than a 404.
  }

  // Aggregate counts.
  const total = sources.length;
  const completed = sources.filter(s => s.effectiveStatus === "completed").length;
  const queued = sources.filter(s => s.effectiveStatus === "queued").length;
  const running = sources.filter(s => s.effectiveStatus === "running").length;
  const failed = sources.filter(s => s.effectiveStatus === "failed").length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pipeline/parse" className="text-[12px] text-white/50">
          ← parse status
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          parse · /{params.productSlug}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{params.productSlug}</h1>
        <div className="flex gap-3 text-[12px] mt-2 flex-wrap">
          <Link href={`/products/${params.productSlug}/raw`} className="text-white/60">
            raw sources →
          </Link>
          <Link href={`/products/${params.productSlug}/parsed`} className="text-white/60">
            parsed sidecars →
          </Link>
          <Link href={`/products/${params.productSlug}`} className="text-white/60">
            extraction →
          </Link>
        </div>
        {total === 0 && (
          <div className="mt-3 panel text-sm text-white/60">
            No own-scope PDFs found for this slug. Sources may live at line or category scope —
            check{" "}
            <Link href={`/products/${params.productSlug}/raw`} className="underline">
              raw sources
            </Link>
            .
          </div>
        )}
        {total > 0 && (
          <div className="mt-3 flex gap-2 flex-wrap">
            <span className={`pill ${STATUS_COLOR.completed}`}>{completed}/{total} parsed</span>
            {queued > 0 && <span className={`pill ${STATUS_COLOR.queued}`}>{queued} queued</span>}
            {running > 0 && <span className={`pill ${STATUS_COLOR.running}`}>{running} running</span>}
            {failed > 0 && <span className={`pill ${STATUS_COLOR.failed}`}>{failed} failed</span>}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="w-24">Status</th>
                <th className="w-32">Size</th>
                <th>Validation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => {
                const sidecarMatch = s.sidecarPath ? manifestMatchForSidecar(s.sidecarPath) : null;
                return (
                  <tr key={s.sourcePath} className="hover:bg-white/[0.04]">
                    <td className="font-mono text-[12px]">
                      <div className="text-white/90">{s.sourcePath.split("/").pop()}</div>
                      <div className="text-white/40 text-[10px]">{s.sourcePath}</div>
                      {sidecarMatch && (
                        <div className="text-[10px] mt-0.5">
                          {sidecarMatch.matched ? (
                            <span className="text-emerald-300/80">
                              ✓ in manifest ({sidecarMatch.productSlugs.length} product
                              {sidecarMatch.productSlugs.length === 1 ? "" : "s"})
                            </span>
                          ) : (
                            <span className="text-amber-300/80">manifest match unknown</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={s.effectiveStatus} />
                      {s.latestRun && (
                        <Link
                          href={`/pipeline/parse/runs/${s.latestRun.id}`}
                          className="block text-[10px] text-white/50 hover:text-white/80 mt-0.5"
                        >
                          run #{s.latestRun.id} →
                        </Link>
                      )}
                    </td>
                    <td className="text-[11px] text-white/60">
                      pdf {formatBytes(s.pdfBytes)}
                      {s.hasSidecar && (
                        <div className="text-white/40 text-[10px]">
                          md {formatBytes(s.sidecarBytes)}
                        </div>
                      )}
                    </td>
                    <ValidationCells src={s} />
                    <td>
                      <div className="flex flex-col gap-1">
                        <RunButton sourcePath={s.sourcePath} hasSidecar={s.hasSidecar} />
                        {s.hasSidecar && (
                          <Link
                            href={`/products/${params.productSlug}/parsed`}
                            className="text-[11px] text-white/60 hover:text-white"
                          >
                            view sidecar →
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
