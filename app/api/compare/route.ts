/**
 * GET /api/compare?left=<slug>&right=<slug>
 *
 * Returns the pairwise diff of two `extraction.json` files. Both query
 * params accept a product slug — the latest extraction for each is loaded
 * from disk and run through diffExtractions().
 *
 * Run-id resolution (compare two runs of the same product) is intentionally
 * out of scope for this iteration; see the linked issue for the follow-up.
 *
 * Response shape:
 *   { left: ExtractionIdentity, right: ExtractionIdentity, diff: ExtractionDiff }
 *
 * Errors:
 *   400 — missing query params
 *   404 — either slug doesn't resolve to an extraction.json on disk
 *   409 — both sides resolve but to incompatible categories
 */
import { NextRequest, NextResponse } from "next/server";
import { getExtraction } from "@/lib/extractions";
import { diffExtractions } from "@/lib/pipeline/extraction-diff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const leftSlug = (url.searchParams.get("left") ?? "").trim();
  const rightSlug = (url.searchParams.get("right") ?? "").trim();

  if (!leftSlug || !rightSlug) {
    return NextResponse.json(
      { error: "left and right query params are required" },
      { status: 400 }
    );
  }
  if (leftSlug === rightSlug) {
    return NextResponse.json(
      { error: "left and right must reference different slugs" },
      { status: 400 }
    );
  }

  const left = getExtraction(leftSlug);
  if (!left) {
    return NextResponse.json(
      { error: `no extraction.json found for slug "${leftSlug}"` },
      { status: 404 }
    );
  }
  const right = getExtraction(rightSlug);
  if (!right) {
    return NextResponse.json(
      { error: `no extraction.json found for slug "${rightSlug}"` },
      { status: 404 }
    );
  }

  const leftCategory = typeof left.category === "string" ? left.category : null;
  const rightCategory = typeof right.category === "string" ? right.category : null;
  if (leftCategory && rightCategory && leftCategory !== rightCategory) {
    return NextResponse.json(
      {
        error: "cross-category comparison is not supported",
        leftCategory,
        rightCategory,
      },
      { status: 409 }
    );
  }

  const diff = diffExtractions(left, right);
  return NextResponse.json(diff);
}
