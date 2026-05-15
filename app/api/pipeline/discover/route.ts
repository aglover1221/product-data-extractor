import { NextRequest, NextResponse } from "next/server";
import { discoverPortfolio } from "@/lib/pipeline/discover";

export const dynamic = "force-dynamic";
// Allow up to 5 minutes — the LLM's web_search loop can chain many queries.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const vendor = String(body?.vendor ?? "").trim();
  const portfolio = String(body?.portfolio ?? "").trim();
  const seedUrl = body?.seedUrl ? String(body.seedUrl).trim() : undefined;
  if (!vendor || !portfolio) {
    return NextResponse.json(
      { error: "vendor and portfolio are required" },
      { status: 400 }
    );
  }
  try {
    const result = await discoverPortfolio({ vendor, portfolio, seedUrl });
    return NextResponse.json({
      discoveryId: result.discoveryId,
      productCount: result.productCount,
      productLineCount: result.productLineCount,
      notes: result.notes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
