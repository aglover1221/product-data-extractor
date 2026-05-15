import Link from "next/link";
import { listDiscoveries } from "@/lib/discovery";

export const dynamic = "force-dynamic";

export default function DiscoveryListPage() {
  const docs = listDiscoveries();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Discovery</h1>
        <p className="text-sm text-white/50 mt-1">
          Vendor-portfolio enumeration runs. Each discovery captures the product-line tree and
          per-product evidence URLs, scoped to a vendor + category.
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="panel text-sm text-white/60">No discovery runs found.</div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th>Run</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>Date</th>
                <th className="text-right">Product lines</th>
                <th className="text-right">Products</th>
                <th>Bootstrap gaps</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.basename} className="hover:bg-white/[0.04]">
                  <td>
                    <Link href={`/discovery/${d.basename}`} className="font-medium">
                      {d.basename}
                    </Link>
                  </td>
                  <td className="text-white/70">{d.vendor}</td>
                  <td>
                    <span className="chip">{d.category}</span>
                  </td>
                  <td>{d.run_date || "—"}</td>
                  <td className="text-right">{d.product_line_count}</td>
                  <td className="text-right">{d.total_products}</td>
                  <td className="text-[11px] text-white/60">
                    {d.fm.total_product_gaps != null
                      ? `${d.fm.total_product_gaps} gap${d.fm.total_product_gaps === 1 ? "" : "s"}`
                      : "—"}
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
