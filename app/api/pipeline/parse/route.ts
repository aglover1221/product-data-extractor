/**
 * POST /api/pipeline/parse
 *
 * Body shapes:
 *   { sourceIds: number[] }                                  — sources rows by id
 *   { productSlug: string, sourcePaths: string[] }           — explicit FS paths (relative to data dir)
 *
 * For each source, submits to Reducto, inserts a parse_runs row, enqueues a
 * reducto-poll job. Returns the parse_run IDs.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureStudioSchema } from "@/lib/db/client";
import { submitParseForSource } from "@/lib/pipeline/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ParseBody {
  sourceIds?: number[];
  productSlug?: string;
  sourcePaths?: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  ensureStudioSchema();
  let body: ParseBody;
  try {
    body = (await req.json()) as ParseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targets: { sourceId?: number; sourcePath?: string }[] = [];
  if (Array.isArray(body.sourceIds) && body.sourceIds.length > 0) {
    for (const id of body.sourceIds) {
      if (Number.isFinite(id)) targets.push({ sourceId: Number(id) });
    }
  } else if (Array.isArray(body.sourcePaths) && body.sourcePaths.length > 0) {
    for (const sp of body.sourcePaths) {
      if (typeof sp === "string" && sp.endsWith(".pdf")) {
        targets.push({ sourcePath: sp });
      }
    }
  }
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "Provide sourceIds[] or sourcePaths[] (.pdf only)" },
      { status: 400 }
    );
  }

  const results: { parseRunId: number; sourcePath: string; reductoJobId: string }[] = [];
  const errors: { target: unknown; error: string }[] = [];

  for (const t of targets) {
    try {
      const r = await submitParseForSource(t);
      results.push(r);
    } catch (err) {
      errors.push({ target: t, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    submitted: results.length,
    failed: errors.length,
    results,
    errors,
  });
}
