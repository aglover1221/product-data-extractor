/**
 * Required-source-type coverage check.
 *
 * Per the `pull-sources` skill § "Required source types by
 * (vendor, category)", each (vendor, category) pair has a baked-in list of
 * source types that MUST yield a successful PDF for the pull to be considered
 * complete. Studio extends the skill's table to cover storage / hci /
 * networking / SDI categories that have proven to need both a tech-guide and
 * a spec-sheet across the Dell portfolio.
 *
 * Coverage NEVER gates extraction — it surfaces gaps for the user to address.
 * Best-effort types (User Guide on HPE, brochure, etc.) are bonuses; their
 * absence does not mark coverage incomplete.
 */
import { resolveProductContext } from "@/lib/pipeline/sources";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";

export type RequiredType =
  | "tech-guide"
  | "spec-sheet"
  | "platform-intro"
  | "support-matrix";

export interface CoverageRule {
  /** Required types — each one must have at least one approved sources row. */
  required: RequiredType[];
  /** "Either-or" pairs: at least one must be satisfied. */
  oneOf?: RequiredType[][];
}

/**
 * Per-(vendor, category) required types. Lowercase vendor + category.
 * Skill canon for server/chassis; studio adds storage/hci/networking/SDI.
 */
const REQUIRED_TYPES_BY_VENDOR_CATEGORY: Record<
  string,
  Record<string, CoverageRule>
> = {
  dell: {
    server: { required: ["tech-guide", "spec-sheet"] },
    storage: {
      // Tech-guide-equivalent on Dell storage is sometimes "platform-intro"
      // (PowerStore / PowerMax convention); accept either.
      required: ["spec-sheet"],
      oneOf: [["tech-guide", "platform-intro"]],
    },
    hci: { required: ["tech-guide", "spec-sheet"] },
    networking: { required: ["tech-guide", "spec-sheet"] },
    chassis: { required: ["spec-sheet"] },
    "software-defined-infrastructure": {
      required: ["tech-guide", "spec-sheet"],
    },
  },
  hpe: {
    server: { required: ["spec-sheet"] }, // QuickSpecs alone is canonical
    chassis: { required: ["spec-sheet"] },
  },
  lenovo: {
    server: { required: ["tech-guide", "spec-sheet"] },
    chassis: { required: ["spec-sheet"] },
  },
};

export interface CoverageReport {
  productSlug: string;
  vendor: string;
  category: string;
  rule: CoverageRule | null;
  /** Approved sources by doc_type. */
  presentTypes: string[];
  /** Required types that are NOT present. */
  missing: RequiredType[];
  /** "oneOf" groups that aren't satisfied. */
  unsatisfiedOneOf: RequiredType[][];
  /** ok = no missing AND every oneOf group satisfied. */
  ok: boolean;
}

export function checkCoverage(productSlug: string): CoverageReport {
  ensureStudioSchema();
  const ctx = resolveProductContext(productSlug);
  if (!ctx) {
    return {
      productSlug,
      vendor: "",
      category: "",
      rule: null,
      presentTypes: [],
      missing: [],
      unsatisfiedOneOf: [],
      ok: true,
    };
  }
  const vendor = ctx.vendor.toLowerCase();
  const category = ctx.category;
  const rule =
    REQUIRED_TYPES_BY_VENDOR_CATEGORY[vendor]?.[category] ?? null;

  const db = getStudioDb();
  const rows = db
    .prepare(`SELECT DISTINCT doc_type FROM sources WHERE product_slug = ?`)
    .all(ctx.slug) as Array<{ doc_type: string }>;
  const presentTypes = rows.map((r) => r.doc_type);
  const presentSet = new Set(presentTypes);

  if (!rule) {
    return {
      productSlug,
      vendor,
      category,
      rule: null,
      presentTypes,
      missing: [],
      unsatisfiedOneOf: [],
      ok: true,
    };
  }

  const missing = rule.required.filter((t) => !presentSet.has(t));
  const unsatisfiedOneOf =
    rule.oneOf?.filter((group) => !group.some((t) => presentSet.has(t))) ?? [];

  return {
    productSlug,
    vendor,
    category,
    rule,
    presentTypes,
    missing,
    unsatisfiedOneOf,
    ok: missing.length === 0 && unsatisfiedOneOf.length === 0,
  };
}

/** Convenience: coverage report for every product slug present in `sources` table. */
export function checkCoverageAll(): CoverageReport[] {
  ensureStudioSchema();
  const db = getStudioDb();
  const slugs = db
    .prepare(`SELECT DISTINCT product_slug FROM sources ORDER BY product_slug ASC`)
    .all() as Array<{ product_slug: string }>;
  return slugs.map((r) => checkCoverage(r.product_slug));
}
