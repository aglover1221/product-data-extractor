import { notFound } from "next/navigation";
import { getDiscovery } from "@/lib/pipeline/discover";
import DiscoveryApprovalView from "./_DiscoveryApprovalView";

export const dynamic = "force-dynamic";

export default function DiscoveryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return notFound();
  const data = getDiscovery(id);
  if (!data) return notFound();

  let raw: any = {};
  try {
    raw = JSON.parse(data.discovery.raw_results ?? "{}");
  } catch {
    raw = {};
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-white/40">Discovery #{id}</div>
        <h1 className="text-xl font-semibold">
          {data.discovery.vendor} — {data.discovery.portfolio}
        </h1>
        <div className="text-xs text-white/50 mt-1 flex flex-wrap items-center gap-3">
          <span className="chip">{data.discovery.status}</span>
          <span>Started: {data.discovery.started_at?.slice(0, 19)}</span>
          {data.discovery.completed_at && (
            <span>Completed: {data.discovery.completed_at.slice(0, 19)}</span>
          )}
          {raw.category && <span>Category: {raw.category}</span>}
        </div>
        {data.discovery.error && (
          <div className="mt-3 text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded px-2 py-1">
            {data.discovery.error}
          </div>
        )}
      </div>

      {raw.product_lines?.length ? (
        <div className="panel">
          <div className="text-sm uppercase tracking-wide text-white/50 mb-2">Product lines</div>
          <ul className="text-sm space-y-1">
            {raw.product_lines.map((pl: any) => (
              <li key={pl.product_line_slug}>
                <span className="font-medium">{pl.product_line_name}</span>{" "}
                <span className="text-white/40">({pl.product_line_slug})</span>
                {pl.evidence_url && (
                  <a
                    href={pl.evidence_url}
                    className="ml-2 text-xs text-white/50 hover:text-white"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pl.evidence_url}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DiscoveryApprovalView
        discoveryId={id}
        products={data.products}
        rawProducts={raw.products ?? []}
      />

      {raw.notes ? (
        <div className="panel text-xs text-white/60 whitespace-pre-wrap">
          <div className="text-sm uppercase tracking-wide text-white/50 mb-1">Notes</div>
          {raw.notes}
        </div>
      ) : null}

      {raw.source_urls_consulted?.length ? (
        <div className="panel text-xs">
          <div className="text-sm uppercase tracking-wide text-white/50 mb-1">
            Source URLs consulted
          </div>
          <ul className="space-y-1">
            {raw.source_urls_consulted.map((u: string) => (
              <li key={u}>
                <a
                  href={u}
                  className="text-white/70 hover:text-white"
                  target="_blank"
                  rel="noreferrer"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
