/**
 * /pipeline/extract — submit a new extraction run.
 *
 * Server component: enumerates products on disk, then renders the client
 * picker form. Accepts query-param prefill from W3:
 *   ?category=server&schema_version=...&products=slug-a,slug-b
 */
import Link from "next/link";
import { env } from "@/lib/env";
import {
  listProductsByCategory,
  type ProductOnDisk,
} from "@/lib/pipeline/products-on-disk";
import ExtractForm from "./_form";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER = [
  "server",
  "storage",
  "hci",
  "networking",
  "chassis",
  "software-defined-infrastructure",
];

interface SearchParams {
  category?: string;
  schema_version?: string;
  products?: string; // comma-separated slugs OR product paths
}

function parseProductList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export default function ExtractPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const grouped = listProductsByCategory();
  // Stable category order; only show categories that actually have products.
  const categories = CATEGORY_ORDER.filter(
    c => (grouped[c]?.length ?? 0) > 0
  );

  const defaultCategory = searchParams.category &&
    categories.includes(searchParams.category)
    ? searchParams.category
    : categories[0] ?? "server";

  const schemaVersion =
    searchParams.schema_version?.trim() || "wave-2-snapshot";

  // Prefill product set: only honor entries that resolve under the chosen
  // category; bare slugs match by suffix.
  const prefillRaw = parseProductList(searchParams.products);
  let defaultProducts: string[] | undefined;
  if (prefillRaw && prefillRaw.length > 0) {
    const pool = grouped[defaultCategory] ?? [];
    defaultProducts = prefillRaw
      .map(ref => {
        const direct = pool.find(p => p.productPathRel === ref);
        if (direct) return direct.productPathRel;
        const bySlug = pool.find(p => p.slug === ref);
        return bySlug ? bySlug.productPathRel : null;
      })
      .filter((s): s is string => s !== null);
  }

  // Trim to fields the client component cares about (avoid leaking internals).
  const productsByCategory: Record<string, Array<Pick<ProductOnDisk,
    "category" | "line" | "slug" | "productPathRel" | "hasExtraction">>> = {};
  for (const cat of categories) {
    productsByCategory[cat] = (grouped[cat] ?? []).map(p => ({
      category: p.category,
      line: p.line,
      slug: p.slug,
      productPathRel: p.productPathRel,
      hasExtraction: p.hasExtraction,
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-white/40">
          <Link href="/pipeline/runs" className="hover:text-white">
            ← run history
          </Link>
        </div>
        <h1 className="text-xl font-semibold mt-1">New extraction run</h1>
        <p className="text-sm text-white/50 mt-1">
          Submit a category-scoped batch via Anthropic Batch + 1h prompt cache.
          Cost estimate is computed before submission; runs over{" "}
          <code className="font-mono">MAX_RUN_USD</code> ($
          {env.MAX_RUN_USD.toFixed(2)}) are refused.
        </p>
      </div>

      {categories.length === 0 ? (
        <div className="panel text-sm text-white/60">
          No products found under <code className="font-mono">{env.PRODUCT_MCP_DATA_DIR}</code>.
        </div>
      ) : (
        <ExtractForm
          categories={categories}
          productsByCategory={productsByCategory}
          defaultCategory={defaultCategory}
          defaultProducts={defaultProducts}
          schemaVersion={schemaVersion}
          maxRunUsd={env.MAX_RUN_USD}
        />
      )}
    </div>
  );
}
