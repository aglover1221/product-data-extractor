/**
 * GET /api/usage/export
 *
 * Returns a CSV of every extraction_runs row, joined to summed token counts
 * from extraction_results. One row per run. RFC-4180-ish formatting.
 *
 * Filename is dated so saving multiple snapshots side-by-side is sensible.
 */
import { type NextRequest } from "next/server";
import { ensureStudioSchema } from "@/lib/db/client";
import { getExportRows, rowsToCsv } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  ensureStudioSchema();
  const rows = getExportRows();
  const csv = rowsToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
