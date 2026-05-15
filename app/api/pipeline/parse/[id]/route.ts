/**
 * GET /api/pipeline/parse/[id] — fetch one parse_run row.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  ensureStudioSchema();
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, source_id, source_path, reducto_job_id, status, output_md_path, validation_json, error, started_at, completed_at
       FROM parse_runs WHERE id = ?`
    )
    .get(id) as
    | {
        id: number;
        source_id: number | null;
        source_path: string;
        reducto_job_id: string | null;
        status: string;
        output_md_path: string | null;
        validation_json: string | null;
        error: string | null;
        started_at: string;
        completed_at: string | null;
      }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let validation: unknown = null;
  if (row.validation_json) {
    try {
      validation = JSON.parse(row.validation_json);
    } catch {
      validation = { raw: row.validation_json };
    }
  }
  return NextResponse.json({ ...row, validation });
}
