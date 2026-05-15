import { NextRequest, NextResponse } from "next/server";
import { acceptSpotfix } from "@/lib/pipeline/spotfix";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const runId = Number(params.runId);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid runId" }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body optional — accept may be called with no extra evidence override.
  }

  try {
    const result = acceptSpotfix(runId, {
      evidenceOverride: body?.evidence,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "accept failed" },
      { status: 500 }
    );
  }
}
