import fs from "node:fs";
import path from "node:path";
import { listExtractions, type ExtractionSummary } from "./extractions";
import { listSources, type SourcesSummary } from "./sources";
import { listDiscoveries, type DiscoverySummary } from "./discovery";
import { getLatestSourcePullPlan, type PlanProduct } from "./plans";
import { readVerifyReportForExtraction, type VerifyReport } from "./verify-reports";
import { readAnnotations, type Annotation } from "./annotations";

export type ProductStageStatus = {
  slug: string;
  discovery: { vendor: string; basename: string; file: string } | null;
  sources: SourcesSummary | null;
  in_plan: PlanProduct | null;
  extraction: ExtractionSummary | null;
  verify: VerifyReport | null;
  annotations_open: number;
  annotations_total: number;
};

/** Look up the stage status for a single product. Used to render the stage breadcrumb. */
export function getProductStageStatus(slug: string): ProductStageStatus {
  const sources = listSources().find((s) => s.slug === slug) ?? null;
  const extraction = listExtractions().find((e) => e.slug === slug) ?? null;
  const plan = getLatestSourcePullPlan();
  const inPlan =
    plan?.in_scope.find((p) => p.canonical_slug === slug) ?? null;

  // Match discovery doc by vendor — the doc with this product's vendor is the discovery source.
  const vendor = sources?.vendor ?? extraction?.vendor ?? inPlan?.vendor ?? "";
  const discoveries = listDiscoveries();
  const discoveryMatch =
    discoveries.find(
      (d) => d.vendor.toLowerCase() === vendor.toLowerCase()
    ) ?? null;

  let verify: VerifyReport | null = null;
  if (extraction) {
    verify = readVerifyReportForExtraction(extraction.source_path);
  }

  let annotations_open = 0;
  let annotations_total = 0;
  if (extraction) {
    const ann = readAnnotations(slug);
    annotations_total = ann.annotations.length;
    annotations_open = ann.annotations.filter((a) => a.status === "open").length;
  }

  return {
    slug,
    discovery: discoveryMatch
      ? { vendor: discoveryMatch.vendor, basename: discoveryMatch.basename, file: discoveryMatch.file }
      : null,
    sources,
    in_plan: inPlan,
    extraction,
    verify,
    annotations_open,
    annotations_total
  };
}

export type AllOpenAnnotation = {
  slug: string;
  vendor: string;
  product_line: string;
  model: string;
  annotation: Annotation;
};

/** Aggregated annotations across every product, with optional filters. */
export function listAnnotationsAcrossProducts(opts?: {
  type?: "flag" | "note" | "all";
  status?: "open" | "resolved" | "wont-fix" | "all";
}): AllOpenAnnotation[] {
  const exts = listExtractions();
  const out: AllOpenAnnotation[] = [];
  for (const ext of exts) {
    const ann = readAnnotations(ext.slug);
    for (const a of ann.annotations) {
      if (opts?.type && opts.type !== "all" && a.type !== opts.type) continue;
      if (opts?.status && opts.status !== "all" && a.status !== opts.status) continue;
      out.push({
        slug: ext.slug,
        vendor: ext.vendor,
        product_line: ext.product_line,
        model: ext.model,
        annotation: a
      });
    }
  }
  out.sort((a, b) => b.annotation.created_at.localeCompare(a.annotation.created_at));
  return out;
}

export type PipelineCounts = {
  discoveries: { runs: number; product_lines: number; products: number };
  sources: { products: number; required_satisfied: number; required_unsatisfied: number };
  plan: {
    in_scope: number;
    deferred: number;
    by_vendor: Record<string, { gp: number; gpu: number; total: number }>;
  };
  extracted: { total: number; servers: number; storage: number };
  verify: { reports: number; pass: number; warn: number; fail: number };
  annotations: { open: number };
};

export function pipelineCounts(): PipelineCounts {
  const ds = listDiscoveries();
  const ss = listSources();
  const exts = listExtractions();
  const plan = getLatestSourcePullPlan();

  let pass = 0,
    warn = 0,
    fail = 0,
    reports = 0;
  for (const ext of exts) {
    const v = readVerifyReportForExtraction(ext.source_path);
    if (!v) continue;
    reports++;
    const verdict = (v.fm.verdict || "").toLowerCase();
    if (verdict === "pass") pass++;
    else if (verdict === "warn") warn++;
    else if (verdict === "fail") fail++;
  }

  let openAnn = 0;
  for (const ext of exts) {
    const a = readAnnotations(ext.slug);
    openAnn += a.annotations.filter((x) => x.status === "open").length;
  }

  const byVendor: Record<string, { gp: number; gpu: number; total: number }> = {};
  for (const p of plan?.in_scope ?? []) {
    const v = (p.vendor || "").trim();
    if (!v) continue;
    if (!byVendor[v]) byVendor[v] = { gp: 0, gpu: 0, total: 0 };
    byVendor[v].total++;
    if (p.server_type === "general-purpose") byVendor[v].gp++;
    else if (p.server_type === "gpu-server") byVendor[v].gpu++;
  }

  return {
    discoveries: {
      runs: ds.length,
      product_lines: ds.reduce((a, d) => a + d.product_line_count, 0),
      products: ds.reduce((a, d) => a + d.total_products, 0)
    },
    sources: {
      products: ss.length,
      required_satisfied: ss.filter((s) => s.required_types_satisfied).length,
      required_unsatisfied: ss.filter((s) => !s.required_types_satisfied).length
    },
    plan: {
      in_scope: plan?.in_scope.length ?? 0,
      deferred: plan?.deferred.length ?? 0,
      by_vendor: byVendor
    },
    extracted: {
      total: exts.length,
      servers: exts.filter((e) => e.kind === "server").length,
      storage: exts.filter((e) => e.kind === "storage").length
    },
    verify: { reports, pass, warn, fail },
    annotations: { open: openAnn }
  };
}
