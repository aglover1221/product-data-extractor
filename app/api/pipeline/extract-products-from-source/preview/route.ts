import { NextResponse, type NextRequest } from "next/server";
import { previewProductsFromSource } from "@/lib/pipeline/extract-products-from-source";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST { sourcePath: "...", category?, vendor?, productLine? }
 *
 * Reads the parsed sidecar at sourcePath, asks the LLM to enumerate the
 * products covered, returns the proposed list. Doesn't write anything to
 * disk.
 *
 * For line-scope sources (`{category}/{vendor}/{line}/source/*.md`), the
 * context is auto-resolved from the path. For category-scope sources, you
 * must pass { category, vendor, productLine } explicitly.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
  if (!sourcePath) {
    return NextResponse.json(
      { error: "sourcePath required" },
      { status: 400 }
    );
  }
  try {
    const result = await previewProductsFromSource(sourcePath, {
      category: body.category,
      vendor: body.vendor,
      productLine: body.productLine,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 400 }
    );
  }
}
