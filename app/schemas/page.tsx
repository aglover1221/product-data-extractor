import Link from "next/link";
import { listSchemas } from "@/lib/schema-md";

export const dynamic = "force-dynamic";

export default function SchemasListPage() {
  const all = listSchemas();
  const base = all.filter((s) => !s.is_overlay);
  const overlays = all.filter((s) => s.is_overlay);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Schemas</h1>
        <p className="text-sm text-white/50 mt-1">
          The structured-data extraction contracts. Each category has a base schema; sub-categories
          add fields via additive overlays.
        </p>
      </div>

      <section>
        <div className="panel-title">Base schemas ({base.length})</div>
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Category</th>
                <th>Last updated</th>
                <th className="text-right">Sections</th>
                <th className="text-right">Fields</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {base.map((s) => (
                <tr key={s.name} className="hover:bg-white/[0.04]">
                  <td>
                    <Link href={`/schemas/${s.name}`} className="font-medium">
                      {s.name}
                    </Link>
                  </td>
                  <td>
                    <span className="chip">{s.fm.type ?? "schema"}</span>
                  </td>
                  <td className="text-white/70">{s.fm.category ?? "—"}</td>
                  <td className="text-[11px] text-white/60">{s.fm.last_updated ?? "—"}</td>
                  <td className="text-right">{s.section_count}</td>
                  <td className="text-right">{s.field_count}</td>
                  <td className="text-[11px] text-white/60 max-w-[420px]">
                    {s.fm.description ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {overlays.length > 0 && (
        <section>
          <div className="panel-title">Overlays ({overlays.length})</div>
          <div className="panel overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Parent</th>
                  <th>Applies when</th>
                  <th>Last updated</th>
                  <th className="text-right">Sections</th>
                  <th className="text-right">Fields</th>
                </tr>
              </thead>
              <tbody>
                {overlays.map((s) => (
                  <tr key={s.name} className="hover:bg-white/[0.04]">
                    <td>
                      <Link href={`/schemas/${s.name}`} className="font-medium">
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <span className="chip">{s.fm.type ?? "overlay"}</span>
                    </td>
                    <td className="text-[11px] text-white/60 font-mono">
                      {s.fm.parent ?? "—"}
                    </td>
                    <td className="text-[11px] text-white/70 font-mono">
                      {s.fm.applies_when ?? "—"}
                    </td>
                    <td className="text-[11px] text-white/60">{s.fm.last_updated ?? "—"}</td>
                    <td className="text-right">{s.section_count}</td>
                    <td className="text-right">{s.field_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
