/**
 * POST /api/pipeline/schema/[name]/rollback
 *
 * Body: { version: string }
 *
 * Loads the historical version's content_md, writes it back to filesystem
 * atomically, and inserts a new version row that "is" that old content but
 * sits at the head of history. Reuses save logic via the helpers.
 */
import { NextResponse } from "next/server";
import {
  findSchemaFile,
  writeSchemaContentAtomic,
} from "@/lib/pipeline/schemas-fs";
import { validateAll } from "@/lib/pipeline/schema-validators";
import {
  getVersionByVersion,
  insertVersion,
  nextVersion,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: { name: string } }) {
  const name = ctx.params.name;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const target: string = String(body?.version ?? "").trim();
  if (!target) return NextResponse.json({ error: "`version` is required" }, { status: 400 });

  seedFromFilesystemIfEmpty();

  const rec = findSchemaFile(name);
  if (!rec) {
    return NextResponse.json({ error: `Schema not found: ${name}` }, { status: 404 });
  }

  const old = getVersionByVersion(name, target);
  if (!old) {
    return NextResponse.json(
      { error: `Version not found: ${target}` },
      { status: 404 },
    );
  }

  const validation = validateAll(old.content_md);
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: "Old version failed validation — refusing to rollback",
        errors: validation.errors,
      },
      { status: 422 },
    );
  }

  const newVersion = nextVersion(name, old.content_md);

  try {
    writeSchemaContentAtomic(rec, old.content_md);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Filesystem write failed: ${e?.message ?? e}` },
      { status: 500 },
    );
  }

  const { id, version } = insertVersion({
    name,
    version: newVersion,
    content_md: old.content_md,
    parent_version_id: old.id,
    status: "active",
  });

  return NextResponse.json({ id, version, rolled_back_from: old.version });
}
