import {
  listCandidatesForProduct,
  listSourcesForProduct,
  resolveProductContext,
} from "@/lib/pipeline/sources";
import { getParseRunsForPath } from "@/lib/pipeline/parse-status";
import SourcesProductView from "./_SourcesProductView";

export const dynamic = "force-dynamic";

export default function ProductSourcesPage({
  params,
}: {
  params: { productSlug: string };
}) {
  const slug = decodeURIComponent(params.productSlug);
  const ctx = resolveProductContext(slug);
  const candidates = listCandidatesForProduct(slug);
  const sourcesRaw = listSourcesForProduct(slug);

  // Enrich each source with its latest parse status. The pull-sources skill
  // says approve = pull = Reducto-parse in one step. Studio splits that:
  // approveCandidate writes the PDF + sources.yaml entry with
  // markdown_sidecar: null, then user triggers parse separately. Surface
  // "pending parse" so users know to trigger parse on /pipeline/parse.
  const sources = sourcesRaw.map((s) => {
    const runs = getParseRunsForPath(s.local_path);
    const latest = runs[0];
    return {
      ...s,
      parse_status: (latest?.status ?? "none") as
        | "queued" | "running" | "completed" | "failed" | "none",
      parse_run_id: latest?.id ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-white/40">Sources</div>
        <h1 className="text-xl font-semibold">{ctx?.canonical_name ?? slug}</h1>
        <div className="text-xs text-white/50 mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono">{slug}</span>
          {ctx?.category && <span className="chip">{ctx.category}</span>}
          {ctx?.vendor && <span className="chip">{ctx.vendor}</span>}
          {ctx?.product_line && <span className="chip">{ctx.product_line}</span>}
        </div>
      </div>

      <SourcesProductView
        productSlug={slug}
        candidates={candidates}
        sources={sources}
        productContext={ctx}
      />
    </div>
  );
}
