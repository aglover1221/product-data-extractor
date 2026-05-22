import Link from "next/link";
import { formatBytes, type SourcesSummary } from "@/lib/sources";
import type { ProductStageStatus } from "@/lib/stages";
import type { VerifyReport } from "@/lib/verify-reports";

function StageBadge({
  href,
  label,
  status,
  detail
}: {
  href?: string;
  label: string;
  status: "ok" | "warn" | "fail" | "missing" | "neutral";
  detail: string;
}) {
  const cls =
    status === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : status === "warn"
      ? "bg-amber-400/15 text-amber-300 border-amber-400/30"
      : status === "fail"
      ? "bg-rose-400/15 text-rose-300 border-rose-400/30"
      : status === "missing"
      ? "bg-white/5 text-white/50 border-white/10"
      : "bg-white/5 text-white/70 border-white/10";

  const inner = (
    <div className={`flex flex-col gap-0.5 px-3 py-2 rounded border ${cls} min-w-[140px]`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-[12px] font-medium">{detail}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PipelineStrip({
  stage,
  serverType
}: {
  stage: ProductStageStatus;
  serverType: string | null;
}) {
  const discoveryDetail = stage.discovery
    ? `${stage.discovery.vendor} run`
    : "no discovery";
  const sourcesDetail = stage.sources
    ? `${stage.sources.source_files.length} files · ${formatBytes(stage.sources.total_bytes)}`
    : "no sources.yaml";
  const sourcesStatus = stage.sources
    ? stage.sources.required_types_satisfied
      ? "ok"
      : "warn"
    : "missing";

  const schemaDetail = serverType ? `server / ${serverType}` : "server";

  let verifyStatus: "ok" | "warn" | "fail" | "missing" = "missing";
  let verifyDetail = "no verify-report";
  if (stage.verify) {
    const verdict = (stage.verify.fm.verdict ?? "").toLowerCase();
    verifyDetail = `verdict ${verdict || "unknown"}`;
    if (verdict === "pass") verifyStatus = "ok";
    else if (verdict === "warn") verifyStatus = "warn";
    else if (verdict === "fail") verifyStatus = "fail";
    else verifyStatus = "warn";
  }

  const annStatus =
    stage.annotations_open > 0 ? "warn" : stage.annotations_total > 0 ? "neutral" : "neutral";
  const annDetail =
    stage.annotations_open > 0
      ? `⚐ ${stage.annotations_open} open`
      : stage.annotations_total > 0
      ? `${stage.annotations_total} resolved`
      : "no annotations";

  return (
    <div className="flex flex-wrap gap-2">
      <StageBadge
        href={stage.discovery ? `/discovery/${stage.discovery.basename}` : undefined}
        label="Discovery"
        status={stage.discovery ? "ok" : "missing"}
        detail={discoveryDetail}
      />
      <StageBadge
        href="/sources"
        label="Sourcing"
        status={sourcesStatus}
        detail={sourcesDetail}
      />
      <StageBadge
        href="/categorization"
        label="Plan"
        status={stage.in_plan ? "ok" : "missing"}
        detail={stage.in_plan ? `in_scope · ${stage.in_plan.server_type ?? "—"}` : "not in plan"}
      />
      <StageBadge
        href={`/schemas/server`}
        label="Schema"
        status="neutral"
        detail={schemaDetail}
      />
      <StageBadge
        label="Extraction"
        status="ok"
        detail={
          stage.extraction
            ? `schema ${stage.extraction.schema_version ?? "—"}`
            : "—"
        }
      />
      <StageBadge label="Verify" status={verifyStatus} detail={verifyDetail} />
      <StageBadge
        href="/inbox"
        label="Annotations"
        status={annStatus}
        detail={annDetail}
      />
    </div>
  );
}

export function SourcesPanel({ sources }: { sources: SourcesSummary | null }) {
  if (!sources || !sources.manifest) {
    return (
      <div className="panel">
        <div className="panel-title font-bold">Sources</div>
        <div className="text-sm text-white/40 italic">no sources.yaml on disk</div>
      </div>
    );
  }
  const m = sources.manifest;
  return (
    <div className="panel">
      <div className="flex items-baseline justify-between mb-3">
        <div className="panel-title mb-0">Sources</div>
        <div className="text-[11px] text-white/40">
          pulled {m.pulled_at ?? "—"}
          {m.pulled_by ? ` · ${m.pulled_by}` : ""}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table min-w-[800px]">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Title</th>
              <th className="text-right">Size</th>
              <th>Validated</th>
              <th>Grep</th>
              <th>SHA256</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {m.sources.map((s, i) => (
              <tr key={i}>
                <td className="font-mono text-[11px]">{s.filename}</td>
                <td>
                  <span className="chip">{s.type}</span>
                  {s.vendor_type_name && (
                    <div className="text-[10px] text-white/40 mt-0.5">{s.vendor_type_name}</div>
                  )}
                </td>
                <td className="text-[12px] text-white/80 max-w-[300px]">{s.title}</td>
                <td className="text-right text-[11px] text-white/60">
                  {s.size_bytes ? formatBytes(s.size_bytes) : "—"}
                </td>
                <td>
                  {s.pdf_validated ? (
                    <span className="pill pill-on">ok</span>
                  ) : (
                    <span className="pill pill-off">—</span>
                  )}
                </td>
                <td>
                  {s.content_grep?.matched ? (
                    <span className="pill pill-on" title={s.content_grep.query}>
                      ok
                    </span>
                  ) : (
                    <span className="pill pill-off">—</span>
                  )}
                </td>
                <td className="text-[10px] font-mono text-white/40" title={s.sha256}>
                  {s.sha256 ? s.sha256.slice(0, 16) : "—"}
                </td>
                <td className="text-[11px]">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-300/80">
                      open ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.failures && m.failures.length > 0 && (
        <details className="mt-3">
          <summary className="text-[11px] uppercase tracking-wider text-amber-300/70 cursor-pointer">
            Source-pull failures ({m.failures.length})
          </summary>
          <div className="space-y-3 mt-2">
            {m.failures.map((f, i) => (
              <div key={i} className="border-l-2 border-amber-300/40 pl-3 text-[12px]">
                <div className="flex flex-wrap items-baseline gap-2 mb-0.5">
                  <span className="chip">{f.logical_type ?? "unknown"}</span>
                  {f.vendor_type_name && (
                    <span className="text-white/60">{f.vendor_type_name}</span>
                  )}
                  <span className="text-amber-300/80">{f.reason}</span>
                </div>
                {f.detail && (
                  <pre className="text-[11px] font-mono text-white/65 whitespace-pre-wrap">
                    {f.detail.trim()}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const SEVERITY_CLS: Record<string, string> = {
  fail: "bg-rose-400/15 text-rose-300 border-rose-400/30",
  warn: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  info: "bg-white/5 text-white/70 border-white/10",
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
};

export function VerifyPanel({ report }: { report: VerifyReport | null }) {
  if (!report) {
    return (
      <div className="panel">
        <div className="panel-title font-bold">Verify-report</div>
        <div className="text-sm text-white/50">
          No <code className="font-mono">verify-report.md</code> on disk. Run the{" "}
          <code className="font-mono">cross-check-extraction</code> skill to generate one.
        </div>
      </div>
    );
  }

  const counts = report.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const verdict = (report.fm.verdict ?? "unknown").toLowerCase();

  return (
    <div className="panel">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="panel-title mb-0">Verify-report</div>
          <div className="text-[11px] text-white/40 font-mono mt-1">
            cohort n={report.fm.peer_cohort_n ?? "—"} · {report.fm.schema_version ?? "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded border text-[12px] font-medium ${
              verdict === "pass"
                ? SEVERITY_CLS.ok
                : verdict === "warn"
                ? SEVERITY_CLS.warn
                : verdict === "fail"
                ? SEVERITY_CLS.fail
                : "border-white/10"
            }`}
          >
            verdict {verdict}
          </span>
          <span className="text-[11px] text-white/50 font-mono">
            fail {counts.fail ?? 0} · warn {counts.warn ?? 0} · info {counts.info ?? 0}
          </span>
        </div>
      </div>
      {report.findings.length === 0 ? (
        <div className="text-sm text-white/50 italic">
          No findings parsed (the report may use a different structure).
        </div>
      ) : (
        <div className="space-y-2">
          {report.findings.map((f, i) => (
            <div
              key={i}
              className={`border-l-2 pl-3 py-1.5 ${
                f.severity === "fail"
                  ? "border-rose-400/60"
                  : f.severity === "warn"
                  ? "border-amber-400/60"
                  : "border-white/15"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-medium ${
                    f.severity === "fail"
                      ? "bg-rose-400/20 text-rose-300"
                      : f.severity === "warn"
                      ? "bg-amber-400/20 text-amber-300"
                      : "bg-white/5 text-white/60"
                  }`}
                >
                  {f.severity}
                </span>
                <span className="text-[12px] text-white/85">{f.title}</span>
              </div>
              {f.body && (
                <pre className="text-[11px] font-mono text-white/65 whitespace-pre-wrap mt-1">
                  {f.body}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
