import { NextResponse, type NextRequest } from "next/server";
import { commitProductsFromSource } from "@/lib/pipeline/extract-products-from-source";

export const runtime = "nodejs";

/**
 * POST { sourcePath: "...", slugs: ["..."], proposed: [...], category?, vendor?, productLine? }
 *
 * Creates product MD skeletons for the approved slugs. `proposed` is the
 * array returned by the preview API, used to pull marketing_name for each
 * skeleton.
 */
export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
  const slugs: string[] = Array.isArray(body.slugs) ? body.slugs : [];
  const proposed = Array.isArray(body.proposed) ? body.proposed : [];
  if (!sourcePath || slugs.length === 0) {
    return NextResponse.json(
      { error: "sourcePath and slugs[] required" },
      { status: 400 }
    );
  }
  try {
    const result = await commitProductsFromSource(sourcePath, slugs, proposed, {
      category: body.category,
      vendor: body.vendor,
      productLine: body.productLine,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 400 }
    );
  }
}
