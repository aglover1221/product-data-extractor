import { NextResponse, type NextRequest } from "next/server";
import {
  distributeProgramDoc,
  listProgramDocStatuses,
  PROGRAM_DOC_CATALOG,
} from "@/lib/pipeline/program-docs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ programs: listProgramDocStatuses() });
}

/**
 * POST — distribute one program doc.
 *
 * Body:
 *   { key: "satisfaction-guarantee", productSlugs?: ["..."], force?: false }
 *
 * If `productSlugs` is omitted, defaults to the catalog's `eligible_products`.
 * Pass `force: true` to re-fetch even if the PDF already exists on disk.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const key = typeof body.key === "string" ? body.key : "";
  const spec = PROGRAM_DOC_CATALOG.find((s) => s.key === key);
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown program key: ${key || "<empty>"}` },
      { status: 404 }
    );
  }
  const result = await distributeProgramDoc(spec, {
    force: body.force === true,
    productSlugs: Array.isArray(body.productSlugs)
      ? body.productSlugs
      : undefined,
  });
  return NextResponse.json(result);
}
