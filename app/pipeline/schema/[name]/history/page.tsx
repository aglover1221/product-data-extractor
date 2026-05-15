/**
 * /pipeline/schema/[name]/history
 *
 * Full version history with selectable diff viewer + per-row rollback.
 * Server side fetches the version list; client component handles diff
 * fetching and rollback POSTs.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findSchemaFile,
} from "@/lib/pipeline/schemas-fs";
import {
  listVersions,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";
import HistoryView from "./_history-view";

export const dynamic = "force-dynamic";

export default function SchemaHistoryPage({ params }: { params: { name: string } }) {
  seedFromFilesystemIfEmpty();
  const rec = findSchemaFile(params.name);
  if (!rec) notFound();

  const versions = listVersions(params.name);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/pipeline/schema/${params.name}`}
          className="text-[12px] text-white/50"
        >
          ← {params.name}
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          history
        </div>
        <h1 className="text-2xl font-semibold mt-1">{params.name}.md — versions</h1>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          {rec.rel_path} · {versions.length} version{versions.length === 1 ? "" : "s"}
        </div>
      </div>

      <HistoryView name={params.name} versions={versions} />
    </div>
  );
}
