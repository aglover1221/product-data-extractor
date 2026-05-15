"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CheckResult = {
  status: "pass" | "fail" | "warn";
  subject: string;
  message: string;
  fixHint?: string;
};

type SubAuditReport = {
  checkName: string;
  description: string;
  results: CheckResult[];
  pass: number;
  fail: number;
  warn: number;
};

type AuditReport = {
  scope: { category?: string };
  generatedAt: string;
  durationMs: number;
  categories: string[];
  totals: { pass: number; fail: number; warn: number };
  subAudits: SubAuditReport[];
};

type StatusFilter = "all" | "fail" | "warn" | "fail+warn";

function statusClass(s: CheckResult["status"]) {
  if (s === "pass") return "text-emerald-300";
  if (s === "warn") return "text-amber-300";
  return "text-red-300";
}

export default function CategoryAuditPage({
  params,
}: {
  params: { category: string };
}) {
  const { category } = params;
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("fail+warn");
  const [activeCheck, setActiveCheck] = useState<string | "all">("all");

  async function runAudit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pipeline/audit?category=${encodeURIComponent(category)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Audit failed");
      else setReport(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    runAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const visibleSubAudits = useMemo(() => {
    if (!report) return [];
    return report.subAudits
      .filter((sa) => activeCheck === "all" || sa.checkName === activeCheck)
      .map((sa) => ({
        ...sa,
        results: sa.results.filter((r) => {
          if (filter === "all") return true;
          if (filter === "fail") return r.status === "fail";
          if (filter === "warn") return r.status === "warn";
          if (filter === "fail+warn")
            return r.status === "fail" || r.status === "warn";
          return true;
        }),
      }))
      .filter((sa) => sa.results.length > 0 || activeCheck === sa.checkName);
  }, [report, filter, activeCheck]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-white/40 mb-1">
            <Link href="/pipeline/audit" className="no-underline hover:underline">
              ← all categories
            </Link>
          </div>
          <h1 className="text-xl font-semibold">Audit · {category}</h1>
          <p className="text-sm text-white/50 mt-1">
            Cross-MD checks scoped to <code className="font-mono">{category}/</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={runAudit}
          disabled={busy}
          className={`px-4 py-2 rounded text-sm font-medium ${
            busy
              ? "bg-white/5 text-white/40 border border-white/10 cursor-not-allowed"
              : "bg-blue-500/20 text-blue-200 border border-blue-400/40 hover:bg-blue-500/30"
          }`}
        >
          {busy ? "Running…" : "Re-run"}
        </button>
      </div>

      {error && (
        <div className="panel text-red-300 text-sm font-mono">{error}</div>
      )}

      {report && (
        <>
          <section className="panel flex flex-wrap gap-4 items-center text-xs">
            <div>
              <span className="text-white/40 mr-2">Status</span>
              {(["all", "fail+warn", "fail", "warn"] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`mr-1 px-2 py-1 rounded border ${
                    filter === f
                      ? "border-white/40 bg-white/10 text-white"
                      : "border-white/10 text-white/50 hover:bg-white/5"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div>
              <span className="text-white/40 mr-2">Check</span>
              <button
                type="button"
                onClick={() => setActiveCheck("all")}
                className={`mr-1 px-2 py-1 rounded border ${
                  activeCheck === "all"
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-white/50 hover:bg-white/5"
                }`}
              >
                all
              </button>
              {report.subAudits.map((sa) => (
                <button
                  key={sa.checkName}
                  type="button"
                  onClick={() => setActiveCheck(sa.checkName)}
                  className={`mr-1 px-2 py-1 rounded border font-mono ${
                    activeCheck === sa.checkName
                      ? "border-white/40 bg-white/10 text-white"
                      : "border-white/10 text-white/50 hover:bg-white/5"
                  }`}
                >
                  {sa.checkName}{" "}
                  <span className="ml-1 text-red-300">{sa.fail}</span>
                  /
                  <span className="text-amber-300">{sa.warn}</span>
                </button>
              ))}
            </div>
          </section>

          {visibleSubAudits.map((sa) => (
            <section key={sa.checkName}>
              <div className="panel-title flex items-center gap-3">
                <span className="font-mono">{sa.checkName}</span>
                <span className="text-white/40 normal-case tracking-normal">
                  {sa.description}
                </span>
              </div>
              <div className="panel overflow-x-auto">
                <table className="data-table w-full">
                  <thead>
                    <tr>
                      <th className="w-16">Status</th>
                      <th>Subject</th>
                      <th>Message</th>
                      <th>Suggested fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sa.results.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-white/40 text-center py-4">
                          No results matching filter.
                        </td>
                      </tr>
                    ) : (
                      sa.results.map((r, i) => (
                        <tr key={`${sa.checkName}-${i}`}>
                          <td className={`uppercase font-mono ${statusClass(r.status)}`}>
                            {r.status}
                          </td>
                          <td className="font-mono text-[11px] text-white/80">
                            {r.subject}
                          </td>
                          <td className="text-[12px]">{r.message}</td>
                          <td className="text-[12px] text-white/60">
                            {r.fixHint ?? "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
