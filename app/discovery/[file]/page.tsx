import Link from "next/link";
import { notFound } from "next/navigation";
import { getDiscoveryDoc } from "@/lib/discovery";
import { listExtractions } from "@/lib/extractions";
import { listSources } from "@/lib/sources";
import { readVerifyReportForExtraction } from "@/lib/verify-reports";
import { annotationCountsBySlug } from "@/lib/annotations";

export const dynamic = "force-dynamic";

type ProductStatus = {
  sourced: boolean;
  extracted: boolean;
  verified: { verdict: string } | null;
  open_annotations: number;
};

function buildStatusBySlug(): Map<string, ProductStatus> {
  const sourced = new Set(listSources().map((s) => s.slug));
  const exts = listExtractions();
  const annCounts = annotationCountsBySlug();
  const map = new Map<string, ProductStatus>();
  for (const slug of sourced) {
    map.set(slug, { sourced: true, extracted: false, verified: null, open_annotations: annCounts.get(slug) ?? 0 });
  }
  for (const e of exts) {
    const cur = map.get(e.slug) ?? {
      sourced: false,
      extracted: false,
      verified: null,
      open_annotations: annCounts.get(e.slug) ?? 0
    };
    cur.extracted = true;
    const v = readVerifyReportForExtraction(e.source_path);
    cur.verified = v ? { verdict: v.fm.verdict ?? "unknown" } : null;
    map.set(e.slug, cur);
  }
  return map;
}

function StatusPills({ status }: { status: ProductStatus | undefined }) {
  if (!status) {
    return <span className="text-[11px] text-white/40">discovered only</span>;
  }
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {status.sourced && (
        <span className="pill pill-on" title="sources.yaml present">
          sourced
        </span>
      )}
      {status.extracted && (
        <span className="pill pill-on" title="extraction.json present">
          extracted
        </span>
      )}
      {status.verified && (
        <span
          className={`pill ${
            status.verified.verdict === "pass"
              ? "pill-on"
              : status.verified.verdict === "warn"
              ? "bg-amber-400/15 text-amber-300"
              : status.verified.verdict === "fail"
              ? "bg-rose-400/15 text-rose-300"
              : "pill-off"
          }`}
          title={`verify-report.md verdict: ${status.verified.verdict}`}
        >
          verify {status.verified.verdict}
        </span>
      )}
      {status.open_annotations > 0 && (
        <span className="pill bg-amber-400/15 text-amber-300" title="open annotations">
          ⚐ {status.open_annotations}
        </span>
      )}
    </div>
  );
}

export default function DiscoveryDetailPage({ params }: { params: { file: string } }) {
  const doc = getDiscoveryDoc(params.file);
  if (!doc) notFound();

  const status = buildStatusBySlug();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40">
          discovery / {doc.fm.vendor ?? "?"} / {doc.fm.category ?? "?"}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{doc.basename}</h1>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          run {doc.fm.run_date ?? "—"} · {doc.product_lines.length} product line
          {doc.product_lines.length === 1 ? "" : "s"} · {" "}
          {doc.product_lines.reduce((acc, pl) => acc + (pl.products?.length ?? 0), 0)} products
        </div>
      </div>

      <section className="panel">
        <div className="panel-title">Run scope</div>
        <dl className="kv">
          <dt>vendor</dt>
          <dd>{doc.fm.vendor ?? "—"}</dd>
          <dt>portfolio</dt>
          <dd>{doc.fm.portfolio_name ?? "—"}</dd>
          <dt>category</dt>
          <dd>{doc.fm.category ?? "—"}</dd>
          <dt>vendor product lines</dt>
          <dd>
            {doc.fm.vendor_product_line_total ?? "—"} total · {doc.fm.enumerated_product_lines ?? "—"} enumerated
          </dd>
          <dt>products enumerated</dt>
          <dd>
            {doc.fm.total_products_enumerated ?? "—"} · gaps{" "}
            {doc.fm.total_product_gaps ?? "—"} · in-kb{" "}
            {doc.fm.total_products_in_knowledgebase ?? "—"}
          </dd>
        </dl>
        {doc.fm.scope_notes && (
          <details className="mt-3">
            <summary className="text-[11px] uppercase tracking-wider text-white/40 cursor-pointer">
              scope notes
            </summary>
            <pre className="mt-2 text-[11px] font-mono text-white/70 whitespace-pre-wrap">
              {doc.fm.scope_notes.trim()}
            </pre>
          </details>
        )}
      </section>

      {doc.product_lines.map((pl) => (
        <section key={pl.product_line_slug ?? pl.product_line_name} className="panel">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium">{pl.product_line_name}</div>
              <div className="text-[11px] text-white/40 font-mono mt-0.5">
                {pl.product_line_slug ?? "—"}
              </div>
            </div>
            <div className="text-[11px] text-white/40">
              {pl.products?.length ?? 0} product{pl.products?.length === 1 ? "" : "s"}
            </div>
          </div>
          {pl.product_line_summary?.positioning_oneliner && (
            <div className="text-[12px] text-white/70 mb-3">
              {pl.product_line_summary.positioning_oneliner}
            </div>
          )}
          {(!pl.products || pl.products.length === 0) ? (
            <div className="text-sm text-white/40 italic">no products listed</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Slug</th>
                    <th>Vendor tag</th>
                    <th>Status</th>
                    <th>Pipeline</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.products.map((p) => {
                    const st = p.slug ? status.get(p.slug) : undefined;
                    return (
                      <tr key={p.slug ?? p.canonical_name}>
                        <td className="font-medium">
                          {st?.extracted && p.slug ? (
                            <Link href={`/products/${p.slug}`}>{p.canonical_name}</Link>
                          ) : (
                            p.canonical_name
                          )}
                        </td>
                        <td className="text-[11px] text-white/40 font-mono">{p.slug ?? "—"}</td>
                        <td className="text-[11px] text-white/60">{p.vendor_tag ?? "—"}</td>
                        <td>
                          <span className="chip">{p.status ?? "—"}</span>
                        </td>
                        <td>
                          <StatusPills status={st} />
                        </td>
                        <td className="text-[11px]">
                          {p.evidence_url ? (
                            <a
                              href={p.evidence_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-300/80"
                            >
                              link ↗
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <div className="text-center">
        <Link href="/discovery" className="text-sm text-white/50">
          ← back to discovery runs
        </Link>
      </div>
    </div>
  );
}
