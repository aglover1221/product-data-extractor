import { NextRequest, NextResponse } from "next/server";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import { writeProductMdSkeleton } from "@/lib/pipeline/product-md-skel";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const discoveryId = Number(params.id);
  if (!Number.isFinite(discoveryId) || discoveryId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const productIds: number[] = Array.isArray(body?.productIds)
    ? body.productIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];
  if (!productIds.length) {
    return NextResponse.json({ error: "productIds required" }, { status: 400 });
  }

  ensureStudioSchema();
  const db = getStudioDb();

  // Fetch the rows + need category — read raw_results JSON for the parent discovery.
  const discovery = db
    .prepare(`SELECT raw_results FROM discoveries WHERE id = ?`)
    .get(discoveryId) as any;
  if (!discovery) {
    return NextResponse.json({ error: "discovery not found" }, { status: 404 });
  }

  let raw: any = {};
  try {
    raw = JSON.parse(discovery.raw_results ?? "{}");
  } catch {
    raw = {};
  }
  const productsByKey = new Map<string, any>();
  for (const p of raw.products ?? []) {
    productsByKey.set(`${p.product_line}/${p.slug}`, p);
  }

  const placeholders = productIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM discovered_products
       WHERE discovery_id = ? AND id IN (${placeholders})`
    )
    .all(discoveryId, ...productIds) as any[];

  const update = db.prepare(
    `UPDATE discovered_products
       SET approval_status='approved', approved_at=?
     WHERE id=?`
  );

  const created: Array<{ slug: string; relPath: string; created: boolean }> = [];
  const errors: Array<{ id: number; error: string }> = [];

  for (const row of rows) {
    const key = `${row.product_line}/${row.slug}`;
    const enriched = productsByKey.get(key);
    const category = String(enriched?.category ?? raw.category ?? "");
    if (!category) {
      errors.push({ id: row.id, error: "category missing" });
      continue;
    }
    try {
      const result = writeProductMdSkeleton({
        category,
        vendor: row.vendor,
        line: row.product_line,
        slug: row.slug,
        model: row.marketing_name ?? enriched?.canonical_name ?? row.slug,
      });
      update.run(new Date().toISOString(), row.id);
      created.push({
        slug: row.slug,
        relPath: result.relPath,
        created: result.created,
      });
    } catch (err: any) {
      errors.push({ id: row.id, error: String(err?.message ?? err) });
    }
  }

  return NextResponse.json({
    approvedCount: created.length,
    created,
    errors,
  });
}
