/**
 * GET /api/pipeline/schema/[name]/diff/[v1]/[v2]
 *
 * Returns a unified diff (string + parsed hunks) between two schema versions.
 * v1 = "from", v2 = "to"; the response shape lets the client do simple
 * line-coloring without a heavy diff renderer.
 */
import { NextResponse } from "next/server";
import { createTwoFilesPatch } from "diff";
import {
  getVersionByVersion,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: { name: string; v1: string; v2: string } },
) {
  const { name, v1, v2 } = ctx.params;
  if (!name || !v1 || !v2) {
    return NextResponse.json({ error: "name, v1, v2 required" }, { status: 400 });
  }
  seedFromFilesystemIfEmpty();

  const left = getVersionByVersion(name, decodeURIComponent(v1));
  const right = getVersionByVersion(name, decodeURIComponent(v2));
  if (!left) return NextResponse.json({ error: `version not found: ${v1}` }, { status: 404 });
  if (!right) return NextResponse.json({ error: `version not found: ${v2}` }, { status: 404 });

  const patch = createTwoFilesPatch(
    `${name}.md @ ${left.version}`,
    `${name}.md @ ${right.version}`,
    left.content_md,
    right.content_md,
    left.created_at,
    right.created_at,
  );

  return NextResponse.json({
    name,
    from: { version: left.version, created_at: left.created_at },
    to: { version: right.version, created_at: right.created_at },
    unified: patch,
  });
}
