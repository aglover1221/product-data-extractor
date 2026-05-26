import { NextRequest, NextResponse } from "next/server";
import {
  readAnnotations,
  writeAnnotations,
  generateId,
  type Annotation,
  type AnnotationStatus,
  type AnnotationType
} from "@/lib/annotations";
import { isFieldPathSafe } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const file = readAnnotations(params.slug);
  return NextResponse.json(file);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const field_path = String(body?.field_path ?? "").trim();
  const type = body?.type as AnnotationType;
  const text = String(body?.text ?? "").trim();

  if (!field_path) {
    return NextResponse.json({ error: "field_path required" }, { status: 400 });
  }
  // field_path is later fed to lib/pipeline/extraction-paths.ts:setField, which
  // walks the extraction.json object graph and writes at the final segment.
  // Reject paths whose shape would land a write on Object.prototype — see
  // lib/safe-path.ts and the spot-fix accept flow.
  if (!isFieldPathSafe(field_path)) {
    return NextResponse.json(
      { error: "field_path malformed or contains forbidden segment" },
      { status: 400 }
    );
  }
  if (type !== "flag" && type !== "note") {
    return NextResponse.json({ error: "type must be 'flag' or 'note'" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  let file;
  try {
    file = readAnnotations(params.slug);
    const ann: Annotation = {
      id: generateId(),
      field_path,
      type,
      text,
      created_at: new Date().toISOString(),
      status: "open",
      resolution_summary: null,
      resolved_at: null
    };
    file.annotations.push(ann);
    writeAnnotations(params.slug, file);
    return NextResponse.json(ann, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const file = readAnnotations(params.slug);
    const idx = file.annotations.findIndex((a) => a.id === id);
    if (idx < 0) return NextResponse.json({ error: "not found" }, { status: 404 });

    const ann = file.annotations[idx];
    if (typeof body.text === "string") ann.text = body.text.trim();
    if (typeof body.resolution_summary === "string" || body.resolution_summary === null) {
      ann.resolution_summary = body.resolution_summary;
    }
    if (
      body.status === "open" ||
      body.status === "resolved" ||
      body.status === "wont-fix"
    ) {
      const next = body.status as AnnotationStatus;
      ann.status = next;
      if (next !== "open") {
        ann.resolved_at = ann.resolved_at ?? new Date().toISOString();
      } else {
        ann.resolved_at = null;
      }
    }
    writeAnnotations(params.slug, file);
    return NextResponse.json(ann);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  try {
    const file = readAnnotations(params.slug);
    const before = file.annotations.length;
    file.annotations = file.annotations.filter((a) => a.id !== id);
    if (file.annotations.length === before) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    writeAnnotations(params.slug, file);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "failed" }, { status: 500 });
  }
}
