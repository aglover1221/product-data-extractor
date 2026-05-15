/**
 * /pipeline/schema/[name]/edit
 *
 * Schema editor page. Loads current MD content, hands it to the client editor.
 * The editor handles save (POST /api/pipeline/schema/save) and routes back to
 * the detail page on success.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findSchemaFile,
  readSchemaContent,
} from "@/lib/pipeline/schemas-fs";
import {
  getLatestVersion,
  seedFromFilesystemIfEmpty,
} from "@/lib/pipeline/schema-versions";
// SchemaEditor is a "use client" component; importing it directly from a
// server component is fine — Next will mark it as a client boundary. The
// editor uses `useEffect` to instantiate CodeMirror so SSR-rendered HTML
// is just an empty container, hydrated on the client.
import SchemaEditor from "../../_editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SchemaEditPage({ params }: { params: { name: string } }) {
  seedFromFilesystemIfEmpty();
  const rec = findSchemaFile(params.name);
  if (!rec) notFound();

  const content = readSchemaContent(params.name) ?? "";
  const latest = getLatestVersion(params.name);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/pipeline/schema/${params.name}`}
          className="text-[12px] text-white/50"
        >
          ← {params.name}
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          edit · {rec.is_overlay ? "overlay" : "base"} schema
        </div>
        <h1 className="text-2xl font-semibold mt-1">{params.name}.md</h1>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          {rec.rel_path} · current {latest?.version ?? rec.version}
        </div>
      </div>

      <SchemaEditor
        name={params.name}
        initialContent={content}
        parentVersion={latest?.version ?? null}
      />
    </div>
  );
}
