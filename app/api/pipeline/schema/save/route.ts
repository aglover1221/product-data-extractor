/**
 * POST /api/pipeline/schema/save
 *
 * Body: { name: string, content_md: string, parentVersion?: string }
 *
 * 1. Validates frontmatter / cross-refs / enum sanity
 * 2. Picks next version label
 * 3. Writes to filesystem atomically (temp + rename)
 * 4. Inserts version row in DB (demoting prior active)
 *
 * Returns: { id, version }
 */
import { NextResponse } from "next/server";
import {
  findSchemaFile,
  type SchemaFsRecord,
} from "@/lib/pipeline/schemas-fs";
import { validateAll } from "@/lib/pipeline/schema-validators";
import {
  getVersionByVersion,
  nextVersion,
  saveSchemaVersionAtomic,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name: string = String(body?.name ?? "").trim();
  const content_md: string = typeof body?.content_md === "string" ? body.content_md : "";
  const parentVersionLabel: string | undefined = body?.parentVersion;

  if (!name) return NextResponse.json({ error: "`name` is required" }, { status: 400 });
  if (!content_md) {
    return NextResponse.json({ error: "`content_md` is required" }, { status: 400 });
  }

  const rec: SchemaFsRecord | null = findSchemaFile(name);
  if (!rec) {
    return NextResponse.json(
      {
        error: `Schema not found on disk: \`${name}\` (no schemas/${name}.md or schemas/overlays/${name}.md)`,
      },
      { status: 404 },
    );
  }

  // Make sure DB has at least the seed rows so version bumps don't collide.
  seedFromFilesystemIfEmpty();

  const validation = validateAll(content_md);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", errors: validation.errors },
      { status: 422 },
    );
  }

  let parent_version_id: number | null = null;
  if (parentVersionLabel) {
    const parent = getVersionByVersion(name, parentVersionLabel);
    if (parent) parent_version_id = parent.id;
  }

  const newVersion = nextVersion(name, content_md);

  try {
    const { id, version } = saveSchemaVersionAtomic(rec, {
      name,
      version: newVersion,
      content_md,
      parent_version_id,
      status: "active",
    });
    return NextResponse.json({ id, version });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Schema save failed: ${e?.message ?? e}` },
      { status: 500 },
    );
  }
}
