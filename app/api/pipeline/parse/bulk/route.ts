/**
 * POST /api/pipeline/parse/bulk
 *
 * Body: { productLine: string, category: string }
 *
 * Bulk re-parse every PDF source in the given product line (and any
 * line-scope sources). Same enqueue pattern as the single-parse route, just
 * fanned out — one parse_run row + one reducto-poll job per PDF.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureStudioSchema } from "@/lib/db/client";
import { submitParseForSource } from "@/lib/pipeline/parse";
import { listSourcesForLine } from "@/lib/pipeline/sources-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BulkBody {
  productLine?: string;
  category?: string;
  /** Optional: limit to {only-unparsed | all}. Defaults to "all" (re-parse). */
  scope?: "only-unparsed" | "all";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  ensureStudioSchema();
  let body: BulkBody;
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { productLine, category } = body;
  if (!productLine || !category) {
    return NextResponse.json(
      { error: "Provide { productLine, category }" },
      { status: 400 }
    );
  }
  const scope = body.scope ?? "all";
  let sources = listSourcesForLine(category, productLine);
  if (scope === "only-unparsed") {
    sources = sources.filter(s => !s.hasSidecar);
  }
  if (sources.length === 0) {
    return NextResponse.json({ submitted: 0, failed: 0, results: [], errors: [] });
  }

  const results: { parseRunId: number; sourcePath: string; reductoJobId: string }[] = [];
  const errors: { sourcePath: string; error: string }[] = [];
  for (const src of sources) {
    try {
      const r = await submitParseForSource({ sourcePath: src.sourcePath });
      results.push(r);
    } catch (err) {
      errors.push({ sourcePath: src.sourcePath, error: (err as Error).message });
    }
  }
  return NextResponse.json({
    submitted: results.length,
    failed: errors.length,
    results,
    errors,
  });
}
