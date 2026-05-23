import Link from "next/link";
import { listSources, formatBytes } from "@/lib/sources";
import { listExtractions } from "@/lib/extractions";

export const dynamic = "force-dynamic";

export default function SourcesPage() {
  const all = listSources();
  const extractedSlugs = new Set(listExtractions().map((e) => e.slug));

  const totals = all.reduce(
    (acc, s) => {
      acc.bytes += s.total_bytes;
      acc.files += s.source_files.length;
      return acc;
    },
    { bytes: 0, files: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Sourcing</h1>
        <p className="text-sm text-white/50 mt-1">
          {all.length} product director{all.length === 1 ? "y" : "ies"} with{" "}
          <code className="font-mono text-white/70">sources.yaml</code> or{" "}
          <code className="font-mono text-white/70">source/</code>. {totals.files} files ·{" "}
          {formatBytes(totals.bytes)} total.
        </p>
      </div>

      {all.length === 0 ? (
        <div className="panel text-sm text-white/60">No source manifests found yet.</div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[1100px]">
            <thead>
              <tr>
                <th>Product</th>
                <th>Vendor / Line</th>
                <th>Files</th>
                <th>Size</th>
                <th>Required types</th>
                <th>Failures</th>
                <th>Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.product_dir} className="hover:bg-white/[0.04]">
                  <td>
                    {extractedSlugs.has(s.slug) ? (
                      <Link href={`/products/${s.slug}`} className="font-medium">
                        {s.slug}
                      </Link>
                    ) : (
                      <span className="font-medium">{s.slug}</span>
                    )}
                    <div className="text-[11px] text-white/40">
                      {s.manifest?.product?.name ?? "—"}
                    </div>
                  </td>
                  <td className="text-white/70">
                    {s.vendor} / {s.product_line}
                  </td>
                  <td>{s.source_files.length}</td>
                  <td className="text-[11px] text-white/60">
                    {formatBytes(s.total_bytes)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1 items-center">
                      {s.required_types_present.map((t) => (
                        <span key={t} className="pill pill-on">
                          {t}
                        </span>
                      ))}
                      {s.required_types_missing.map((t) => (
                        <span
                          key={t}
                          className="pill bg-rose-400/15 text-rose-300"
                          title="declared as required for this vendor; not present"
                        >
                          {t} missing
                        </span>
                      ))}
                    </div>
                    <div className="text-[10px] text-white/40 mt-0.5">{s.required_types_rule}</div>
                  </td>
                  <td>
                    {s.failures_count > 0 ? (
                      <span className="pill bg-amber-400/15 text-amber-300">
                        {s.failures_count} failure{s.failures_count === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-white/40">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className="pill pill-on">sourced</span>
                      {extractedSlugs.has(s.slug) && (
                        <span className="pill pill-on">extracted</span>
                      )}
                    </div>
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
