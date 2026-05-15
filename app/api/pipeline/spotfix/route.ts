import { NextRequest, NextResponse } from "next/server";
import { runSpotfix } from "@/lib/pipeline/spotfix";

export const dynamic = "force-dynamic";
// Spot-fix may take up to ~60s end-to-end (LLM round-trip).
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const productSlug = String(body?.productSlug ?? "").trim();
  const annotationId = String(body?.annotationId ?? "").trim();
  if (!productSlug || !annotationId) {
    return NextResponse.json(
      { error: "productSlug and annotationId required" },
      { status: 400 }
    );
  }

  try {
    const result = await runSpotfix(productSlug, annotationId);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "spot-fix failed" },
      { status: 500 }
    );
  }
}
