import Link from "next/link";
import { listDiscoveries } from "@/lib/pipeline/discover";
import NewDiscoveryForm from "./_NewDiscoveryForm";

export const dynamic = "force-dynamic";

export default function DiscoverIndexPage() {
  const rows = listDiscoveries();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Discover Portfolio</h1>
        <p className="text-sm text-white/50 mt-1">
          Enumerate every product in a vendor portfolio (e.g. &ldquo;Dell PowerEdge&rdquo;,
          &ldquo;Dell Storage&rdquo;) via LLM-driven web search. Approve a subset to mint product
          MD skeletons under {`{category}/{vendor}/{line}/{slug}/`} on disk.
        </p>
      </div>

      <NewDiscoveryForm />

      <div>
        <h2 className="text-sm uppercase tracking-wide text-white/50 mb-2">Past discoveries</h2>
        {rows.length === 0 ? (
          <div className="panel text-sm text-white/60">No discovery runs yet.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Vendor</th>
                  <th>Portfolio</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d: any) => (
                  <tr key={d.id} className="hover:bg-white/[0.04]">
                    <td className="text-white/50">{d.id}</td>
                    <td>{d.vendor}</td>
                    <td>{d.portfolio}</td>
                    <td>
                      <span className="chip">{d.status}</span>
                    </td>
                    <td>{d.product_count}</td>
                    <td className="text-xs text-white/50">{d.started_at?.slice(0, 19) ?? ""}</td>
                    <td>
                      <Link href={`/pipeline/discover/${d.id}`} className="text-sm">
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
    </div>
  );
}
