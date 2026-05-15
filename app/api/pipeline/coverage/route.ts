import { NextResponse, type NextRequest } from "next/server";
import {
  checkCoverage,
  checkCoverageAll,
} from "@/lib/pipeline/coverage";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("productSlug");
  if (slug) {
    return NextResponse.json(checkCoverage(slug));
  }
  return NextResponse.json({ reports: checkCoverageAll() });
}
