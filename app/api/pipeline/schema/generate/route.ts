import { NextRequest, NextResponse } from "next/server";
import { generateSchema } from "@/lib/pipeline/schema-gen";

export const dynamic = "force-dynamic";
// Schema generation is an interactive Anthropic call; allow time for the model to respond.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const category = String(body?.category ?? "").trim();
  const referenceMdPaths: string[] = Array.isArray(body?.referenceMdPaths)
    ? body.referenceMdPaths.map((s: any) => String(s))
    : [];
  const skeletonMd =
    typeof body?.skeletonMd === "string" && body.skeletonMd.trim()
      ? body.skeletonMd
      : undefined;

  if (!category) {
    return NextResponse.json({ error: "category required" }, { status: 400 });
  }
  if (referenceMdPaths.length === 0) {
    return NextResponse.json(
      { error: "at least one referenceMdPaths entry required" },
      { status: 400 }
    );
  }

  try {
    const result = await generateSchema({
      category,
      referenceMdPaths,
      skeletonMd,
    });
    return NextResponse.json({
      schemaId: result.schemaId,
      name: result.name,
      version: result.version,
      content_md: result.contentMd,
      estimate: result.estimate,
      usage: result.usage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
