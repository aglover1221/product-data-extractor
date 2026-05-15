import Link from "next/link";
import { listAnnotationsAcrossProducts } from "@/lib/stages";

export const dynamic = "force-dynamic";

type FilterType = "flag" | "note" | "all";
type FilterStatus = "open" | "resolved" | "wont-fix" | "all";

function ageString(iso: string): string {
  try {
    const then = Date.parse(iso);
    if (isNaN(then)) return "—";
    const now = Date.now();
    const ms = Math.max(0, now - then);
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  } catch {
    return "—";
  }
}

function FilterBar({ type, status }: { type: FilterType; status: FilterStatus }) {
  const types: FilterType[] = ["all", "flag", "note"];
  const statuses: FilterStatus[] = ["open", "resolved", "wont-fix", "all"];
  const link = (t: FilterType, s: FilterStatus) =>
    `/inbox?type=${t}&status=${s}`;

  return (
    <div className="flex flex-wrap gap-3 text-[12px]">
      <div className="flex items-center gap-1">
        <span className="text-white/50 mr-1">type</span>
        {types.map((t) => (
          <Link
            key={t}
            href={link(t, status)}
            className={`px-2 py-0.5 rounded ${
              t === type ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-white/50 mr-1">status</span>
        {statuses.map((s) => (
          <Link
            key={s}
            href={link(type, s)}
            className={`px-2 py-0.5 rounded ${
              s === status ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function InboxPage({
  searchParams
}: {
  searchParams: { type?: string; status?: string };
}) {
  const type = ((searchParams.type as FilterType) ?? "all") as FilterType;
  const status = ((searchParams.status as FilterStatus) ?? "open") as FilterStatus;
  const all = listAnnotationsAcrossProducts({ type, status });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-white/50 mt-1">
          Human-in-the-loop annotations across every product. Use the spot-fix-extraction skill to
          address open flags.
        </p>
      </div>

      <FilterBar type={type} status={status} />

      <div className="text-[11px] text-white/40">
        {all.length} annotation{all.length === 1 ? "" : "s"} matching filters
      </div>

      {all.length === 0 ? (
        <div className="panel text-sm text-white/60">No matching annotations.</div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[1000px]">
            <thead>
              <tr>
                <th>Product</th>
                <th>Field</th>
                <th>Type</th>
                <th>Status</th>
                <th>Text</th>
                <th>Created</th>
                <th className="text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {all.map(({ slug, model, vendor, product_line, annotation: a }) => (
                <tr key={`${slug}-${a.id}`} className="hover:bg-white/[0.04]">
                  <td>
                    <Link href={`/products/${slug}`} className="font-medium">
                      {model}
                    </Link>
                    <div className="text-[11px] text-white/40">
                      {vendor.replace(" Technologies", "")} / {product_line}
                    </div>
                  </td>
                  <td className="font-mono text-[11px] text-white/80">{a.field_path}</td>
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
                        a.status === "open"
                          ? "bg-amber-400/15 text-amber-300"
                          : a.status === "resolved"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "pill-off"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td
                    className="text-[12px] text-white/80 max-w-[360px] truncate"
                    title={a.text}
                  >
                    {a.text}
                  </td>
                  <td className="text-[11px] text-white/50 font-mono">
                    {a.created_at.split("T")[0]}
                  </td>
                  <td className="text-right text-[11px] text-white/50 font-mono">
                    {ageString(a.created_at)}
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
