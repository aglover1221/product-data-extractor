import { NextResponse, type NextRequest } from "next/server";
import { listOrphans, deleteOrphans } from "@/lib/pipeline/orphan-sweep";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("productSlug");
  if (!slug) {
    return NextResponse.json({ error: "productSlug required" }, { status: 400 });
  }
  return NextResponse.json(listOrphans(slug));
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* default */
  }
  const slug = typeof body.productSlug === "string" ? body.productSlug : "";
  if (!slug) {
    return NextResponse.json({ error: "productSlug required" }, { status: 400 });
  }
  const result = deleteOrphans(slug, {
    dryRun: body.dryRun !== false,
    confirmDelete: body.confirmDelete === true,
  });
  if (result.manifestMissing && body.dryRun === false) {
    return NextResponse.json(result, { status: 409 });
  }
  if (result.requiresConfirmation) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
