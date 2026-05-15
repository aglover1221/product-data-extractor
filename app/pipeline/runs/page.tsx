/**
 * /pipeline/runs — extraction run history.
 *
 * Newest-first list of every extraction_runs row. Click through to
 * /pipeline/runs/[id] for per-product detail.
 */
import Link from "next/link";
import { ensureStudioSchema } from "@/lib/db/client";
import { listRuns } from "@/lib/pipeline/runs";

export const dynamic = "force-dynamic";

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")}Z`;
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
      return "pill bg-sky-400/15 text-sky-300";
    default:
      return "pill pill-off";
  }
}

export default function RunsPage() {
  ensureStudioSchema();
  const runs = listRuns();

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Extraction runs</h1>
          <p className="text-sm text-white/50 mt-1">
            {runs.length} run{runs.length === 1 ? "" : "s"} to date. Click any
            row for per-product detail.
          </p>
        </div>
        <Link
          href="/pipeline/extract"
          className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-sm"
        >
          New extraction →
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="panel text-sm text-white/60">
          No extraction runs yet. Submit one from{" "}
          <Link href="/pipeline/extract">/pipeline/extract</Link>.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[1100px]">
            <thead>
              <tr>
                <th>ID</th>
                <th>Submitted</th>
                <th>Schema</th>
                <th className="text-right">Products</th>
                <th>Status</th>
                <th className="text-right">OK</th>
                <th className="text-right">Fail</th>
                <th className="text-right">Estimate</th>
                <th className="text-right">Actual</th>
                <th>Batch ID</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const products = (() => {
                  try {
                    return (JSON.parse(r.product_set_json) as string[]).length;
                  } catch {
                    return r.request_count ?? 0;
                  }
                })();
                return (
                  <tr key={r.id} className="hover:bg-white/[0.04]">
                    <td>
                      <Link
                        href={`/pipeline/runs/${r.id}`}
                        className="font-mono"
                      >
                        #{r.id}
                      </Link>
                    </td>
                    <td className="text-[11px] text-white/70 font-mono">
                      {fmtDate(r.submitted_at)}
                    </td>
                    <td>
                      <span className="font-medium">{r.schema_name}</span>
                      <span className="text-white/40 ml-1 text-[11px]">
                        {r.schema_version}
                      </span>
                    </td>
                    <td className="text-right">{products}</td>
                    <td>
                      <span className={statusPill(r.status)}>{r.status}</span>
                    </td>
                    <td className="text-right text-emerald-300">
                      {r.success_count ?? 0}
                    </td>
                    <td className="text-right text-rose-300">
                      {r.fail_count ?? 0}
                    </td>
                    <td className="text-right">
                      {fmtUsd(r.cost_estimate_usd)}
                    </td>
                    <td className="text-right">
                      {fmtUsd(r.cost_actual_usd)}
                    </td>
                    <td className="text-[11px] text-white/40 font-mono">
                      {r.batch_id ?? "—"}
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
