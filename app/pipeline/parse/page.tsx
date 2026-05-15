import Link from "next/link";
import { summarizeBoard } from "@/lib/pipeline/parse-status";
import ParseFilters from "./_filters";
import BulkReparseButton from "./_bulk-button";
import ExtractProductsButton from "./_extract-products-button";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  server: "Servers",
  chassis: "Chassis",
  storage: "Storage",
  networking: "Networking",
  hci: "HCI",
  "software-defined-infrastructure": "Software-Defined Infrastructure",
};

interface SearchParams {
  status?: string;
  slug?: string;
}

function statusBadge(status: string, count: number, color: string) {
  if (count === 0) return null;
  return (
    <span className={`pill ${color}`} title={status}>
      {count} {status}
    </span>
  );
}

function progressBar(parsed: number, total: number) {
  if (total === 0) return null;
  const pct = Math.round((parsed / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded bg-white/5 overflow-hidden">
        <div className="h-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-white/50 tabular-nums w-16">
        {parsed}/{total}
      </span>
    </div>
  );
}

export default function ParseStatusBoard({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const board = summarizeBoard();
  const slugFilter = (searchParams.slug ?? "").trim().toLowerCase();
  const statusFilter = (searchParams.status ?? "all").trim().toLowerCase();

  function lineMatches(line: (typeof board)[number]["productLines"][number]): boolean {
    if (slugFilter) {
      const found = line.products.some(p => p.productSlug.toLowerCase().includes(slugFilter));
      if (!found) return false;
    }
    if (statusFilter === "all") return true;
    if (statusFilter === "queued") return line.queued > 0;
    if (statusFilter === "running") return line.running > 0;
    if (statusFilter === "failed") return line.failed > 0;
    if (statusFilter === "completed") return line.parsed > 0;
    if (statusFilter === "unparsed") return line.unparsed > 0;
    return true;
  }

  function productMatches(p: { productSlug: string; queued: number; running: number; failed: number; withSidecar: number; withoutSidecar: number; total: number }): boolean {
    if (slugFilter && !p.productSlug.toLowerCase().includes(slugFilter)) return false;
    if (statusFilter === "all") return true;
    if (statusFilter === "queued") return p.queued > 0;
    if (statusFilter === "running") return p.running > 0;
    if (statusFilter === "failed") return p.failed > 0;
    if (statusFilter === "completed") return p.withSidecar > 0;
    if (statusFilter === "unparsed") return p.withoutSidecar > 0;
    return true;
  }

  let totalSources = 0;
  let totalParsed = 0;
  let totalFailed = 0;
  for (const c of board) {
    for (const l of c.productLines) {
      totalSources += l.totalSources;
      totalParsed += l.parsed;
      totalFailed += l.failed;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/40">pipeline · phase 3</div>
          <h1 className="text-xl font-semibold mt-1">Parse status</h1>
          <p className="text-sm text-white/50 mt-1">
            {totalParsed}/{totalSources} sources parsed across {board.length} categor
            {board.length === 1 ? "y" : "ies"}
            {totalFailed > 0 && (
              <>
                {" · "}
                <span className="text-rose-300">{totalFailed} failed</span>
              </>
            )}
          </p>
        </div>
        <ParseFilters />
      </div>

      {board.map(cat => {
        const visibleLines = cat.productLines.filter(lineMatches);
        if (visibleLines.length === 0) return null;
        return (
          <section key={cat.category}>
            <h2 className="text-sm uppercase tracking-wider text-white/60 mb-3">
              {CATEGORY_LABEL[cat.category] ?? cat.category}
            </h2>
            <div className="space-y-3">
              {visibleLines.map(line => {
                const visibleProducts = line.products.filter(productMatches);
                return (
                  <div key={line.productLine} className="panel">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                      <div>
                        <div className="text-sm font-medium">{line.productLine}</div>
                        <div className="text-[11px] text-white/40 font-mono">
                          {cat.category}/dell/{line.productLine}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {progressBar(line.parsed, line.totalSources)}
                        <div className="flex gap-1.5">
                          {statusBadge("queued", line.queued, "bg-sky-500/15 text-sky-200")}
                          {statusBadge("running", line.running, "bg-amber-500/15 text-amber-200")}
                          {statusBadge("failed", line.failed, "bg-rose-500/15 text-rose-200")}
                        </div>
                        <BulkReparseButton
                          category={cat.category}
                          productLine={line.productLine}
                          totalSources={line.totalSources}
                          unparsed={line.unparsed}
                        />
                      </div>
                    </div>
                    {line.lineSources.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        <div className="text-[11px] uppercase tracking-wider text-white/40">
                          Line-scope sources ({line.lineSources.length})
                        </div>
                        <table className="data-table text-[12px]">
                          <tbody>
                            {line.lineSources.map(src => {
                              const filename = src.sourcePath.split("/").pop() ?? src.sourcePath;
                              const sidecarRel = src.sidecarPath ?? src.sourcePath.replace(/\.pdf$/i, ".md");
                              return (
                                <tr key={src.sourcePath}>
                                  <td className="font-mono text-white/70">{filename}</td>
                                  <td className="w-32">
                                    <span
                                      className={`pill ${
                                        src.effectiveStatus === "completed"
                                          ? "bg-emerald-500/15 text-emerald-200"
                                          : src.effectiveStatus === "failed"
                                          ? "bg-rose-500/15 text-rose-200"
                                          : "bg-white/5 text-white/50"
                                      }`}
                                    >
                                      {src.effectiveStatus === "none" ? "unparsed" : src.effectiveStatus}
                                    </span>
                                  </td>
                                  <td className="w-44 text-right">
                                    <ExtractProductsButton
                                      sidecarPath={sidecarRel}
                                      label={filename}
                                      disabled={src.effectiveStatus !== "completed"}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {visibleProducts.length === 0 ? (
                      <div className="text-[11px] text-white/30 italic">
                        {line.totalProducts === 0
                          ? "no product MDs on disk yet — use the line-source extractor above"
                          : "no products match filter"}
                      </div>
                    ) : (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Slug</th>
                            <th className="w-32">Sources</th>
                            <th className="w-32">Status</th>
                            <th className="w-24"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleProducts.map(p => (
                            <tr key={p.productSlug} className="hover:bg-white/[0.04]">
                              <td className="font-mono text-[12px] text-white/80">{p.productSlug}</td>
                              <td>{progressBar(p.withSidecar, p.total)}</td>
                              <td>
                                <div className="flex gap-1.5">
                                  {statusBadge("q", p.queued, "bg-sky-500/15 text-sky-200")}
                                  {statusBadge("r", p.running, "bg-amber-500/15 text-amber-200")}
                                  {statusBadge("✗", p.failed, "bg-rose-500/15 text-rose-200")}
                                </div>
                              </td>
                              <td>
                                <Link
                                  href={`/pipeline/parse/${p.productSlug}`}
                                  className="text-[11px] text-white/70 hover:text-white"
                                >
                                  detail →
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {board.length === 0 && (
        <div className="panel text-sm text-white/60">
          No source PDFs found under <code className="font-mono">PRODUCT_MCP_DATA_DIR</code>.
        </div>
      )}
    </div>
  );
}
