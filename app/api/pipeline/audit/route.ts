import { NextRequest, NextResponse } from "next/server";
import { auditPortfolio } from "@/lib/pipeline/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  try {
    const report = await auditPortfolio(
      category ? { category } : undefined
    );
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const category =
    typeof body?.category === "string" && body.category.trim()
      ? body.category.trim()
      : undefined;
  try {
    const report = await auditPortfolio(category ? { category } : undefined);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
