import Link from "next/link";
import { readAnnotations } from "@/lib/annotations";
import { listExtractions } from "@/lib/extractions";
import SpotfixButton from "@/app/_components/SpotfixButton";
import BulkSpotfix from "./_bulk";

export const dynamic = "force-dynamic";

export default function ProductSpotfixPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = params.slug;
  const ext = listExtractions().find((e) => e.slug === slug);
  if (!ext) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Spot-fix · {slug}</h1>
        <div className="panel text-sm text-white/60">
          No extraction.json found for slug <span className="font-mono">{slug}</span>.
          Spot-fix requires an existing extraction.
        </div>
        <Link href="/inbox" className="text-xs text-white/50 hover:text-white">
          ← back to inbox
        </Link>
      </div>
    );
  }

  const ann = readAnnotations(slug);
  const open = ann.annotations.filter(
    (a) => a.type === "flag" && a.status === "open"
  );
  const others = ann.annotations.filter(
    (a) => !(a.type === "flag" && a.status === "open")
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Spot-fix · {ext.model}</h1>
          <p className="text-sm text-white/50 mt-1">
            <span className="font-mono">{slug}</span> · {open.length} open
            flag{open.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/products/${slug}`}
            className="text-xs text-white/50 hover:text-white"
          >
            product detail
          </Link>
          <Link href="/inbox" className="text-xs text-white/50 hover:text-white">
            inbox
          </Link>
        </div>
      </div>

      {open.length === 0 ? (
        <div className="panel text-sm text-white/60">
          No open flags for this product. Notes and resolved annotations are listed
          below for reference.
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-white/50">
                Open flags
              </div>
              <BulkSpotfix
                productSlug={slug}
                annotationIds={open.map((a) => a.id)}
              />
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Reasoning</th>
                  <th>Created</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {open.map((a) => (
                  <tr key={a.id} className="hover:bg-white/[0.04]">
                    <td className="font-mono text-[11px] text-white/85 align-top">
                      {a.field_path}
                    </td>
                    <td className="text-[12px] text-white/80 max-w-[480px]">
                      {a.text}
                    </td>
                    <td className="text-[11px] text-white/50 font-mono align-top">
                      {a.created_at.split("T")[0]}
                    </td>
                    <td className="text-right align-top">
                      <SpotfixButton
                        productSlug={slug}
                        annotationId={a.id}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {others.length > 0 && (
        <div className="panel">
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
            Other annotations ({others.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Type</th>
                <th>Status</th>
                <th>Text</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {others.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-[11px] text-white/70">
                    {a.field_path}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        a.type === "flag"
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-blue-400/15 text-blue-300"
                      }`}
                    >
                      {a.type}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        a.status === "resolved"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "pill-off"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="text-[12px] text-white/70 max-w-[360px] truncate">
                    {a.text}
                  </td>
                  <td className="text-[11px] text-white/50 max-w-[360px] truncate">
                    {a.resolution_summary ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
