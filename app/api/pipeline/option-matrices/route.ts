import { NextResponse, type NextRequest } from "next/server";
import {
  listMatrixStatuses,
  refreshIfStale,
  refreshAllStale,
  OPTION_MATRIX_CATALOG,
} from "@/lib/pipeline/option-matrices";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET — list status (per matrix: present, stale, age days, file size).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vendor = sp.get("vendor") ?? undefined;
  const category = sp.get("category") ?? undefined;
  return NextResponse.json({ matrices: listMatrixStatuses({ vendor, category }) });
}

/**
 * POST — refresh. Body shapes:
 *   { filename: "..." }                     refresh one matrix
 *   { vendor?: "...", category?: "..." }    refresh all stale in scope
 *   { all: true, force?: true }             refresh every matrix in catalog
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (typeof body.filename === "string") {
    const spec = OPTION_MATRIX_CATALOG.find(
      (s) => s.filename === body.filename
    );
    if (!spec) {
      return NextResponse.json(
        { error: `Unknown matrix filename: ${body.filename}` },
        { status: 404 }
      );
    }
    const result = await refreshIfStale(spec, { force: body.force === true });
    return NextResponse.json({ results: [result] });
  }

  if (body.all === true) {
    const all = OPTION_MATRIX_CATALOG;
    const results = await Promise.all(
      all.map((s) => refreshIfStale(s, { force: body.force === true }))
    );
    return NextResponse.json({ results });
  }

  const results = await refreshAllStale({
    vendor: typeof body.vendor === "string" ? body.vendor : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
  });
  return NextResponse.json({ results });
}
