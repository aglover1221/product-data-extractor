import Link from "next/link";
import { listProductsWithSourceStatus } from "@/lib/pipeline/sources";

export const dynamic = "force-dynamic";

export default function SourcesIndexPage() {
  const rows = listProductsWithSourceStatus();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Sources</h1>
        <p className="text-sm text-white/50 mt-1">
          Per-product source acquisition status. Approved sources are written under{" "}
          <code className="font-mono">{`{product}/source/`}</code>; pending candidates wait for
          user approval.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="panel text-sm text-white/60">
          No products in source flow yet. Run a discovery, approve products, then trigger
          source-find from a product&apos;s detail page.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[800px]">
            <thead>
              <tr>
                <th>Product slug</th>
                <th className="text-right">Approved</th>
                <th className="text-right">Pending</th>
                <th className="text-right">Failed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.product_slug} className="hover:bg-white/[0.04]">
                  <td className="font-mono text-xs">{r.product_slug}</td>
                  <td className="text-right">{r.approved_count}</td>
                  <td className="text-right">{r.pending_count}</td>
                  <td className="text-right text-red-300/80">{r.failed_count}</td>
                  <td>
                    <Link
                      href={`/pipeline/sources/${encodeURIComponent(r.product_slug)}`}
                      className="text-sm"
                    >
                      Open →
                    </Link>
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
