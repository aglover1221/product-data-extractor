import Link from "next/link";
import { getLatestSourcePullPlan, listSourcePullPlans } from "@/lib/plans";
import { listExtractions } from "@/lib/extractions";

export const dynamic = "force-dynamic";

export default function CategorizationPage() {
  const plan = getLatestSourcePullPlan();
  const allPlans = listSourcePullPlans();
  const extractedSlugs = new Set(listExtractions().map((e) => e.slug));

  if (!plan) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Categorization</h1>
        <div className="panel text-sm text-white/60">
          No <code className="font-mono">source-pull-plan-*.md</code> found in{" "}
          <code className="font-mono">_planning/</code>.
        </div>
      </div>
    );
  }

  const inScope = plan.in_scope;
  const deferred = plan.deferred;

  // Build vendor × server_type grid for in-scope
  const vendors = Array.from(new Set(inScope.map((p) => p.vendor || "").filter(Boolean))).sort();
  const serverTypes = Array.from(
    new Set(inScope.map((p) => p.server_type || "").filter(Boolean))
  ).sort();
  const grid: Record<string, Record<string, number>> = {};
  for (const v of vendors) {
    grid[v] = {};
    for (const t of serverTypes) grid[v][t] = 0;
  }
  for (const p of inScope) {
    const v = p.vendor || "";
    const t = p.server_type || "";
    if (grid[v] && t in grid[v]) grid[v][t]++;
  }

  // Deferral reason breakdown
  const reasonCounts: Record<string, number> = {};
  for (const d of deferred) {
    const r = (d.deferral_reason || "unknown").split("(")[0].trim() || "unknown";
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  }
  const reasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Categorization</h1>
        <p className="text-sm text-white/50 mt-1">
          From <code className="font-mono">{plan.basename}.md</code> · {plan.fm.scope ?? "—"}
        </p>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          {inScope.length} in-scope · {deferred.length} deferred
        </div>
      </div>

      {allPlans.length > 1 && (
        <div className="text-[11px] text-white/40">
          Latest of {allPlans.length} plans on disk:{" "}
          {allPlans
            .map((p) => p.basename)
            .slice(0, 5)
            .join(" · ")}
        </div>
      )}

      <section>
        <div className="panel-title">In-scope by vendor × server_type</div>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                {serverTypes.map((t) => (
                  <th key={t} className="text-right">
                    {t}
                  </th>
                ))}
                <th className="text-right">total</th>
                <th className="text-right">extracted</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const total = serverTypes.reduce((acc, t) => acc + grid[v][t], 0);
                const vendorScopeCount = inScope.filter((p) => p.vendor === v).length;
                const extractedHere = inScope.filter(
                  (p) => p.vendor === v && p.canonical_slug && extractedSlugs.has(p.canonical_slug)
                ).length;
                return (
                  <tr key={v}>
                    <td className="font-medium">{v}</td>
                    {serverTypes.map((t) => (
                      <td key={t} className="text-right">
                        {grid[v][t] || "—"}
                      </td>
                    ))}
                    <td className="text-right">{total || vendorScopeCount}</td>
                    <td className="text-right text-white/70">{extractedHere}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="panel-title">Deferred — reason breakdown</div>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th className="text-right">Products</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map(([r, n]) => (
                <tr key={r}>
                  <td>{r}</td>
                  <td className="text-right">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="panel-title">In-scope products ({inScope.length})</div>
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Product</th>
                <th>Slug</th>
                <th>Product line</th>
                <th>Server type</th>
                <th>Output dir</th>
                <th>Notes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {inScope.map((p, i) => {
                const isExtracted = p.canonical_slug && extractedSlugs.has(p.canonical_slug);
                return (
                  <tr key={`${p.canonical_slug}-${i}`}>
                    <td className="text-white/70">{p.vendor}</td>
                    <td>
                      {isExtracted && p.canonical_slug ? (
                        <Link href={`/products/${p.canonical_slug}`} className="font-medium">
                          {p.product_name}
                        </Link>
                      ) : (
                        <span className="font-medium">{p.product_name}</span>
                      )}
                    </td>
                    <td className="text-[11px] text-white/40 font-mono">{p.canonical_slug}</td>
                    <td className="text-[11px] text-white/60">{p.product_line_slug}</td>
                    <td>
                      <span className="chip">{p.server_type ?? "—"}</span>
                    </td>
                    <td className="text-[11px] text-white/50 font-mono max-w-[260px] truncate">
                      {p.output_dir}
                    </td>
                    <td className="text-[11px] text-white/60 max-w-[300px]">{p.notes ?? ""}</td>
                    <td>
                      {isExtracted ? (
                        <span className="pill pill-on">extracted</span>
                      ) : (
                        <span className="pill pill-off">pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {deferred.length > 0 && (
        <section>
          <div className="panel-title">Deferred products ({deferred.length})</div>
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Product</th>
                  <th>Product line</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {deferred.map((d, i) => (
                  <tr key={`${d.product_name}-${i}`}>
                    <td className="text-white/70">{d.vendor}</td>
                    <td>{d.product_name}</td>
                    <td className="text-[11px] text-white/60">{d.product_line}</td>
                    <td className="text-[11px] text-white/70">{d.deferral_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {plan.ambiguities_md && (
        <section className="panel">
          <div className="panel-title">Ambiguities flagged for review</div>
          <pre className="text-[12px] font-mono whitespace-pre-wrap text-white/80">
            {plan.ambiguities_md}
          </pre>
        </section>
      )}
    </div>
  );
}
