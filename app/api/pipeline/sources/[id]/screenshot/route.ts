import { NextRequest, NextResponse } from "next/server";
import { getCandidate } from "@/lib/pipeline/sources";
import { fetchAndValidatePdf } from "@/lib/pipeline/pdf-validation";
import { firstPageScreenshot } from "@/lib/pipeline/pdf-screenshot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const cand = getCandidate(id);
  if (!cand) {
    return NextResponse.json({ error: "candidate not found" }, { status: 404 });
  }
  // Re-fetch to get the bytes (validation result not persisted).
  const v = await fetchAndValidatePdf(cand.url);
  if (!v.ok || !v.bytes) {
    return NextResponse.json(
      { error: v.error ?? "fetch failed" },
      { status: 400 }
    );
  }
  const shot = await firstPageScreenshot(v.bytes);
  if (!shot.ok || !shot.dataUrl) {
    return NextResponse.json(
      { error: shot.error ?? "screenshot failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ dataUrl: shot.dataUrl });
}
