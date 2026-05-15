/**
 * /pipeline/schema
 *
 * Schema list. Crosses on-disk schemas with DB version history so
 * each row shows: name, current version, last edited, status.
 */
import Link from "next/link";
import { listSchemaFiles } from "@/lib/pipeline/schemas-fs";
import {
  listVersions,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";

export const dynamic = "force-dynamic";

export default function PipelineSchemaListPage() {
  // First-run seed; idempotent.
  seedFromFilesystemIfEmpty();

  const files = listSchemaFiles();
  const rows = files.map((rec) => {
    const versions = listVersions(rec.name);
    const head = versions[0]; // newest by id
    return {
      ...rec,
      current_version: head?.version ?? rec.version,
      version_count: versions.length,
      last_edited_at: head?.created_at ?? null,
      status: head?.status ?? "active",
    };
  });

  const base = rows.filter((r) => !r.is_overlay);
  const overlays = rows.filter((r) => r.is_overlay);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40">pipeline · phase 5</div>
        <h1 className="text-xl font-semibold mt-1">Schemas</h1>
        <p className="text-sm text-white/50 mt-1">
          Edit category schemas with version history. Filesystem
          (<span className="font-mono">{`schemas/*.md`}</span>) is canonical;
          DB tracks every save. Save → bump version → re-extract affected.
        </p>
      </div>

      <Section title={`Base schemas (${base.length})`} rows={base} />
      {overlays.length > 0 && (
        <Section title={`Overlays (${overlays.length})`} rows={overlays} />
      )}
    </div>
  );
}

type SchemaRow = {
  name: string;
  rel_path: string;
  is_overlay: boolean;
  current_version: string;
  version_count: number;
  last_edited_at: string | null;
  status: string;
};

function Section({ title, rows }: { title: string; rows: SchemaRow[] }) {
  return (
    <section>
      <div className="panel-title">{title}</div>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Current version</th>
              <th className="text-right">Versions</th>
              <th>Last edited</th>
              <th>Status</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="hover:bg-white/[0.04]">
                <td>
                  <Link
                    href={`/pipeline/schema/${r.name}`}
                    className="font-medium"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="font-mono text-[12px]">{r.current_version}</td>
                <td className="text-right text-white/60">{r.version_count}</td>
                <td className="text-[11px] text-white/60">
                  {r.last_edited_at
                    ? new Date(r.last_edited_at).toISOString().slice(0, 16).replace("T", " ")
                    : "—"}
                </td>
                <td>
                  <StatusPill value={r.status} />
                </td>
                <td className="text-[11px] text-white/40 font-mono">{r.rel_path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ value }: { value: string }) {
  if (value === "active") {
    return <span className="pill bg-emerald-500/15 text-emerald-300">active</span>;
  }
  if (value === "draft") {
    return <span className="pill bg-amber-500/15 text-amber-300">draft</span>;
  }
  return <span className="pill pill-off">{value}</span>;
}

