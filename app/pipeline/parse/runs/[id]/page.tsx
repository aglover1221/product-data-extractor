import Link from "next/link";
import { notFound } from "next/navigation";
import { getParseRunById } from "@/lib/pipeline/parse-status";
import { findSource } from "@/lib/pipeline/sources-fs";
import { formatBytes } from "@/lib/sources";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  queued: "bg-sky-500/15 text-sky-200",
  running: "bg-amber-500/15 text-amber-200",
  completed: "bg-emerald-500/15 text-emerald-200",
  failed: "bg-rose-500/15 text-rose-200",
};

export default function ParseRunDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();
  const run = getParseRunById(id);
  if (!run) notFound();

  const fsEntry = findSource(run.source_path);
  const productSlug = fsEntry?.productSlug ?? null;

  const v = (run.validation ?? null) as
    | {
        pageCount?: number;
        tableCount?: number;
        anchorCount?: number;
        textDensity?: number;
        charCount?: number;
        warnings?: string[];
        imagesKept?: number;
        imagesFiltered?: number;
        imagesFailed?: number;
      }
    | null;

  const elapsed = run.completed_at
    ? Math.round(
        (new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000
      )
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pipeline/parse" className="text-[12px] text-white/50">
          ← parse status
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          parse run · #{run.id}
        </div>
        <h1 className="text-2xl font-semibold mt-1">
          run #{run.id}{" "}
          <span className={`pill align-middle ml-2 ${STATUS_COLOR[run.status] ?? "bg-white/5 text-white/40"}`}>
            {run.status}
          </span>
        </h1>
      </div>

      <div className="panel">
        <div className="panel-title">Lineage</div>
        <dl className="kv">
          <dt>source path</dt>
          <dd>
            {productSlug ? (
              <Link href={`/pipeline/parse/${productSlug}`} className="hover:underline">
                {run.source_path}
              </Link>
            ) : (
              run.source_path
            )}
          </dd>
          <dt>output sidecar</dt>
          <dd>{run.output_md_path ?? <span className="text-white/30">—</span>}</dd>
          <dt>reducto job id</dt>
          <dd>{run.reducto_job_id ?? <span className="text-white/30">—</span>}</dd>
          <dt>sources row id</dt>
          <dd>{run.source_id ?? <span className="text-white/30">—</span>}</dd>
          <dt>started</dt>
          <dd>{run.started_at}</dd>
          <dt>completed</dt>
          <dd>
            {run.completed_at ?? <span className="text-white/30">—</span>}
            {elapsed != null && <span className="text-white/40 ml-2">({elapsed}s)</span>}
          </dd>
        </dl>
      </div>

      {v && (
        <div className="panel">
          <div className="panel-title">Validation report</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="pages" value={v.pageCount ?? "?"} />
            <Card label="tables" value={v.tableCount ?? "?"} />
            <Card label="anchors" value={v.anchorCount ?? "?"} />
            <Card
              label="chars/page"
              value={v.textDensity ?? "?"}
              warn={typeof v.textDensity === "number" && v.textDensity < 500}
            />
            {v.charCount != null && <Card label="total chars" value={formatBytes(v.charCount)} />}
            {v.imagesKept != null && (
              <Card label="images kept" value={v.imagesKept} />
            )}
            {v.imagesFiltered != null && v.imagesFiltered > 0 && (
              <Card label="images filtered" value={v.imagesFiltered} />
            )}
            {v.imagesFailed != null && v.imagesFailed > 0 && (
              <Card label="images failed" value={v.imagesFailed} warn />
            )}
          </div>
          {v.warnings && v.warnings.length > 0 && (
            <div className="mt-3 rounded border border-rose-400/30 bg-rose-500/5 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-rose-200/70 mb-1">Warnings</div>
              <ul className="text-[12px] text-rose-200/90 space-y-0.5 list-disc list-inside">
                {v.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {run.error && (
        <div className="panel border-rose-400/30 bg-rose-500/5">
          <div className="panel-title text-rose-200/70">Error</div>
          <pre className="text-[12px] text-rose-200/90 whitespace-pre-wrap break-words">{run.error}</pre>
        </div>
      )}

      {run.validation_json && (
        <div className="panel">
          <div className="panel-title">Validation JSON</div>
          <pre className="text-[11px] font-mono text-white/70 whitespace-pre-wrap break-words">
            {JSON.stringify(JSON.parse(run.validation_json), null, 2)}
          </pre>
        </div>
      )}

      <div className="flex gap-3 text-[12px]">
        {productSlug && (
          <Link href={`/pipeline/parse/${productSlug}`} className="text-white/60 hover:text-white">
            ← back to {productSlug}
          </Link>
        )}
        {run.output_md_path && productSlug && (
          <Link href={`/products/${productSlug}/parsed`} className="text-white/60 hover:text-white">
            view sidecars →
          </Link>
        )}
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded border ${
        warn ? "border-rose-400/30 bg-rose-500/5" : "border-white/10 bg-white/[0.02]"
      } px-3 py-2`}
    >
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`text-base font-mono mt-0.5 ${warn ? "text-rose-200" : "text-white/90"}`}>
        {value}
      </div>
    </div>
  );
}
