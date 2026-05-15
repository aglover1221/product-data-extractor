/**
 * GET /api/pipeline/schema/[name]/versions
 *
 * Returns the version history for a schema. Sorted newest-first by `id`.
 */
import { NextResponse } from "next/server";
import { listVersions, seedFromFilesystemIfEmpty } from "@/lib/pipeline/schema-versions";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: { name: string } },
) {
  const name = ctx.params.name;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  seedFromFilesystemIfEmpty();
  const versions = listVersions(name);
  return NextResponse.json({ versions });
}
