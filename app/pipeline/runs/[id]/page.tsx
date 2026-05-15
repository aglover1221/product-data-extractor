/**
 * /pipeline/runs/[id] — extraction run detail.
 *
 * Shows run metadata + per-product result table. Failed rows surface the error
 * message; completed rows link to /products/[slug]. Per-row "Re-extract" button
 * resubmits a single-product batch.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureStudioSchema } from "@/lib/db/client";
import { getRun, listRunResults } from "@/lib/pipeline/runs";
import ReExtractButton from "@/app/_components/ReExtractButton";

export const dynamic = "force-dynamic";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")}Z`;
}

function statusPill(status: string): string {
  switch (status) {
    case "completed":
      return "pill bg-emerald-500/15 text-emerald-300";
    case "completed-with-errors":
      return "pill bg-amber-400/15 text-amber-300";
    case "failed":
      return "pill bg-rose-500/20 text-rose-300";
    case "processing":
    case "submitted":
    case "queued":
    case "running":
      return "pill bg-sky-400/15 text-sky-300";
    default:
      return "pill pill-off";
  }
}

export default function RunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  ensureStudioSchema();
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();
  const run = getRun(id);
  if (!run) notFound();
  const results = listRunResults(id);

  // Resolve a category root from the schema_name (e.g. "storage:san-block-array" → "storage").
  const categoryRoot = run.schema_name.split(":")[0];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40">
          <Link href="/pipeline/runs" className="hover:text-white">
            ← all runs
          </Link>
        </div>
        <h1 className="text-xl font-semibold mt-1">Run #{run.id}</h1>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          submitted {fmtDate(run.submitted_at)} · schema {run.schema_name} ·
          version {run.schema_version}
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">Run metadata</div>
        <dl className="kv">
          <dt>status</dt>
          <dd>
            <span className={statusPill(run.status)}>{run.status}</span>
          </dd>
          <dt>batch id</dt>
          <dd className="font-mono text-[12px]">{run.batch_id ?? "—"}</dd>
          <dt>submitted</dt>
          <dd>{fmtDate(run.submitted_at)}</dd>
          <dt>completed</dt>
          <dd>{fmtDate(run.completed_at)}</dd>
          <dt>products</dt>
          <dd>{run.request_count ?? results.length}</dd>
          <dt>success / fail</dt>
          <dd className="font-mono">
            <span className="text-emerald-300">{run.success_count ?? 0}</span>{" "}
            <span className="text-white/40">/</span>{" "}
            <span className="text-rose-300">{run.fail_count ?? 0}</span>
          </dd>
          <dt>cost estimate</dt>
          <dd>{fmtUsd(run.cost_estimate_usd)}</dd>
          <dt>cost actual</dt>
          <dd>{fmtUsd(run.cost_actual_usd)}</dd>
        </dl>
      </section>

      <section className="panel">
        <div className="flex items-baseline justify-between mb-3">
          <div className="panel-title mb-0">Per-product results</div>
          <div className="text-[11px] text-white/40">
            {results.length} row{results.length === 1 ? "" : "s"}
          </div>
        </div>
        {results.length === 0 ? (
          <div className="text-sm text-white/50 italic">no result rows yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Status</th>
                  <th className="text-right">Input tok</th>
                  <th className="text-right">Output tok</th>
                  <th className="text-right">Cache rd</th>
                  <th className="text-right">Cache wr</th>
                  <th>Output</th>
                  <th>Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.id} className="hover:bg-white/[0.04]">
                    <td className="font-medium">
                      {r.status === "completed" ? (
                        <Link href={`/products/${r.product_slug}`}>
                          {r.product_slug}
                        </Link>
                      ) : (
                        r.product_slug
                      )}
                    </td>
                    <td>
                      <span className={statusPill(r.status)}>{r.status}</span>
                    </td>
                    <td className="text-right">
                      {r.input_tokens?.toLocaleString() ?? "—"}
                    </td>
                    <td className="text-right">
                      {r.output_tokens?.toLocaleString() ?? "—"}
                    </td>
                    <td className="text-right">
                      {r.cache_read_tokens?.toLocaleString() ?? "—"}
                    </td>
                    <td className="text-right">
                      {r.cache_creation_tokens?.toLocaleString() ?? "—"}
                    </td>
                    <td className="text-[11px] text-white/60 font-mono">
                      {r.output_path ?? "—"}
                    </td>
                    <td
                      className="text-[11px] text-rose-300 max-w-[260px] truncate"
                      title={r.error_message ?? ""}
                    >
                      {r.error_message ?? ""}
                    </td>
                    <td>
                      <ReExtractButton
                        productSlug={r.product_slug}
                        category={categoryRoot}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="text-center text-[11px] text-white/30 py-2">
        Status updates land as the worker polls Anthropic. Refresh to see
        progress.
      </div>
    </div>
  );
}
