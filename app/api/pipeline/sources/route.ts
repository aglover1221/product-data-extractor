import { NextRequest, NextResponse } from "next/server";
import { findSources } from "@/lib/pipeline/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const productSlug = String(body?.productSlug ?? "").trim();
  if (!productSlug) {
    return NextResponse.json({ error: "productSlug required" }, { status: 400 });
  }
  try {
    const result = await findSources(productSlug);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
