/**
 * Discover phase — enumerate every product in a vendor portfolio.
 *
 * Mirrors the `discover-portfolio` skill. Single LLM call with
 * web_search enabled; the model browses the vendor's portfolio page +
 * cross-references the manuals listing, and returns a structured JSON object
 * the orchestrator persists into `discoveries` + `discovered_products`.
 *
 * The skill writes a discovery MD to disk; in the studio app, the SQLite row
 * IS the discovery record (the MD format is preserved in raw_results JSON for
 * audit, but the canonical state lives in the DB and the discovered_products
 * rows). On approve, we mint product MDs from the discovered_products rows
 * via lib/pipeline/product-md-skel.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import { searchWithTool, extractJson } from "@/lib/integrations/search";

const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");

export interface DiscoverInput {
  vendor: string;
  portfolio: string;
  seedUrl?: string;
}

export interface DiscoverProduct {
  vendor: string; // lowercase
  product_line: string;
  category: string;
  slug: string;
  canonical_name: string;
  marketing_name?: string | null;
  candidate_url?: string | null;
}

export interface DiscoverProductLine {
  product_line_name: string;
  product_line_slug: string;
  category: string;
  evidence_url: string;
}

export interface DiscoverResult {
  discoveryId: number;
  productCount: number;
  productLineCount: number;
  productLines: DiscoverProductLine[];
  products: DiscoverProduct[];
  notes: string;
  sourceUrlsConsulted: string[];
}

interface RawLLMOutput {
  vendor?: string;
  portfolio?: string;
  category?: string;
  source_urls_consulted?: string[];
  product_lines?: Array<{
    product_line_name?: string;
    product_line_slug?: string;
    category?: string;
    evidence_url?: string;
  }>;
  products?: Array<{
    vendor?: string;
    product_line?: string;
    category?: string;
    slug?: string;
    canonical_name?: string;
    marketing_name?: string | null;
    candidate_url?: string | null;
  }>;
  notes?: string;
}

/**
 * Run the discover-portfolio LLM call and persist results to SQLite.
 */
export async function discoverPortfolio(
  args: DiscoverInput
): Promise<DiscoverResult> {
  ensureStudioSchema();
  const db = getStudioDb();

  const startedAt = new Date().toISOString();
  const insertDiscovery = db.prepare(
    `INSERT INTO discoveries (vendor, portfolio, seed_url, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`
  );
  const info = insertDiscovery.run(
    args.vendor,
    args.portfolio,
    args.seedUrl ?? null,
    startedAt
  );
  const discoveryId = Number(info.lastInsertRowid);

  let parsed: RawLLMOutput;
  let rawText: string;
  try {
    const promptTemplate = fs.readFileSync(
      path.join(PROMPTS_DIR, "discover.md"),
      "utf8"
    );
    const userMessage = buildDiscoverUserMessage(promptTemplate, args);
    const result = await searchWithTool(userMessage, {
      maxTokens: 16_384,
    });
    rawText = result.text;
    parsed = extractJson<RawLLMOutput>(rawText);
  } catch (err: any) {
    db.prepare(
      `UPDATE discoveries SET status='failed', error=?, completed_at=? WHERE id=?`
    ).run(String(err?.message ?? err), new Date().toISOString(), discoveryId);
    throw err;
  }

  const productLines = normalizeProductLines(parsed);
  const products = normalizeProducts(parsed, productLines);

  // Insert discovered products
  const insertProduct = db.prepare(
    `INSERT INTO discovered_products
       (discovery_id, vendor, product_line, slug, marketing_name, candidate_url, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  );
  const insertMany = db.transaction((rows: DiscoverProduct[]) => {
    for (const p of rows) {
      insertProduct.run(
        discoveryId,
        p.vendor,
        p.product_line,
        p.slug,
        p.canonical_name ?? p.marketing_name ?? null,
        p.candidate_url ?? null
      );
    }
  });
  insertMany(products);

  // Persist raw results for audit (whole LLM JSON + product line tree)
  const rawPayload = JSON.stringify({
    vendor: parsed.vendor ?? args.vendor,
    portfolio: parsed.portfolio ?? args.portfolio,
    category: parsed.category ?? null,
    source_urls_consulted: parsed.source_urls_consulted ?? [],
    product_lines: productLines,
    products,
    notes: parsed.notes ?? "",
    raw_text: rawText,
  });

  db.prepare(
    `UPDATE discoveries SET status='completed', raw_results=?, completed_at=? WHERE id=?`
  ).run(rawPayload, new Date().toISOString(), discoveryId);

  return {
    discoveryId,
    productCount: products.length,
    productLineCount: productLines.length,
    productLines,
    products,
    notes: parsed.notes ?? "",
    sourceUrlsConsulted: parsed.source_urls_consulted ?? [],
  };
}

function buildDiscoverUserMessage(
  promptTemplate: string,
  args: DiscoverInput
): string {
  const inputs = [
    `vendor: ${args.vendor}`,
    `portfolio: ${args.portfolio}`,
    args.seedUrl ? `seed_url: ${args.seedUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${promptTemplate}\n\n---\n\n## This invocation\n\n${inputs}\n\nRun the steps above and return the JSON object now.`;
}

function normalizeProductLines(parsed: RawLLMOutput): DiscoverProductLine[] {
  const out: DiscoverProductLine[] = [];
  for (const pl of parsed.product_lines ?? []) {
    if (!pl?.product_line_slug || !pl?.product_line_name) continue;
    out.push({
      product_line_name: String(pl.product_line_name),
      product_line_slug: String(pl.product_line_slug).toLowerCase(),
      category: String(pl.category ?? parsed.category ?? "").toLowerCase(),
      evidence_url: String(pl.evidence_url ?? ""),
    });
  }
  return out;
}

function normalizeProducts(
  parsed: RawLLMOutput,
  productLines: DiscoverProductLine[]
): DiscoverProduct[] {
  const lineCategoryByLineSlug = new Map(
    productLines.map((pl) => [pl.product_line_slug, pl.category])
  );
  const out: DiscoverProduct[] = [];
  for (const p of parsed.products ?? []) {
    if (!p?.slug || !p?.product_line) continue;
    const lineSlug = String(p.product_line).toLowerCase();
    const category =
      String(p.category ?? lineCategoryByLineSlug.get(lineSlug) ?? parsed.category ?? "").toLowerCase();
    out.push({
      vendor: String(p.vendor ?? parsed.vendor ?? "").toLowerCase(),
      product_line: lineSlug,
      category,
      slug: String(p.slug).toLowerCase(),
      canonical_name: String(p.canonical_name ?? p.marketing_name ?? p.slug),
      marketing_name: p.marketing_name ?? null,
      candidate_url: p.candidate_url ?? null,
    });
  }
  return out;
}

/** Return the discovery row + its discovered_products. */
export function getDiscovery(discoveryId: number) {
  ensureStudioSchema();
  const db = getStudioDb();
  const discovery = db
    .prepare(`SELECT * FROM discoveries WHERE id = ?`)
    .get(discoveryId) as any;
  if (!discovery) return null;
  const products = db
    .prepare(
      `SELECT * FROM discovered_products WHERE discovery_id = ? ORDER BY product_line, slug`
    )
    .all(discoveryId) as any[];
  return { discovery, products };
}

export function listDiscoveries() {
  ensureStudioSchema();
  const db = getStudioDb();
  return db
    .prepare(
      `SELECT d.*, COUNT(dp.id) AS product_count
       FROM discoveries d
       LEFT JOIN discovered_products dp ON dp.discovery_id = d.id
       GROUP BY d.id
       ORDER BY d.started_at ASC`
    )
    .all() as any[];
}
