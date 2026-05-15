/**
 * GET /api/pipeline/runs/[id]
 *
 * Returns:
 *   { run: ExtractionRunRow, results: ExtractionResultRow[] }
 *
 * Powers the run-detail UI. Read-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureStudioSchema } from "@/lib/db/client";
import { getRun, listRunResults } from "@/lib/pipeline/runs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  ensureStudioSchema();
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  const results = listRunResults(id);
  return NextResponse.json({ run, results });
}
