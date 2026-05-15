import { NextRequest, NextResponse } from "next/server";
import { rejectSpotfix } from "@/lib/pipeline/spotfix";

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
    // body optional
  }

  try {
    const result = rejectSpotfix(runId, body?.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "reject failed" },
      { status: 500 }
    );
  }
}
