"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AuditReport = {
  scope: { category?: string };
  generatedAt: string;
  durationMs: number;
  categories: string[];
  totals: { pass: number; fail: number; warn: number };
  byCategory: Record<string, { pass: number; fail: number; warn: number }>;
  subAudits: Array<{
    checkName: string;
    description: string;
    pass: number;
    fail: number;
    warn: number;
  }>;
};

export default function AuditOverviewPage() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/audit", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Audit failed");
      } else {
        setReport(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    runAudit();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Portfolio audit</h1>
          <p className="text-sm text-white/50 mt-1">
            Cross-MD consistency, manifest resolution, cross-link resolution,
            orphan detection. Pure-code checks — no LLM, runs in seconds.
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
          {busy ? "Running…" : "Run audit"}
        </button>
      </div>

      {error && (
        <div className="panel text-red-300 text-sm font-mono">{error}</div>
      )}

      {report && (
        <>
          <section className="panel">
            <div className="panel-title font-bold">Summary</div>
            <dl className="kv">
              <dt>Generated at</dt>
              <dd>{new Date(report.generatedAt).toLocaleString()}</dd>
              <dt>Duration</dt>
              <dd>{report.durationMs} ms</dd>
              <dt>Pass</dt>
              <dd className="text-emerald-300">{report.totals.pass}</dd>
              <dt>Warn</dt>
              <dd className="text-amber-300">{report.totals.warn}</dd>
              <dt>Fail</dt>
              <dd className="text-red-300">{report.totals.fail}</dd>
            </dl>
          </section>

          <section>
            <div className="panel-title">Categories</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {report.categories.map((cat) => {
                const c = report.byCategory[cat] ?? { pass: 0, fail: 0, warn: 0 };
                return (
                  <Link
                    key={cat}
                    href={`/pipeline/audit/${cat}`}
                    className="panel hover:bg-white/[0.04] no-underline block"
                  >
                    <div className="text-sm font-semibold mb-2 text-white">
                      {cat}
                    </div>
                    <div className="text-xs space-y-0.5">
                      <div>
                        <span className="text-emerald-300 font-mono mr-1">
                          {c.pass}
                        </span>
                        <span className="text-white/40">pass</span>
                      </div>
                      <div>
                        <span className="text-amber-300 font-mono mr-1">
                          {c.warn}
                        </span>
                        <span className="text-white/40">warn</span>
                      </div>
                      <div>
                        <span className="text-red-300 font-mono mr-1">
                          {c.fail}
                        </span>
                        <span className="text-white/40">fail</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          <section>
            <div className="panel-title">Sub-audits</div>
            <div className="panel overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Description</th>
                    <th className="!text-right">Pass</th>
                    <th className="!text-right">Warn</th>
                    <th className="!text-right">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  {report.subAudits.map((sa) => (
                    <tr key={sa.checkName}>
                      <td className="font-mono">{sa.checkName}</td>
                      <td className="text-white/70 text-[12px]">
                        {sa.description}
                      </td>
                      <td className="!text-right text-emerald-300">{sa.pass}</td>
                      <td className="!text-right text-amber-300">{sa.warn}</td>
                      <td className="!text-right text-red-300">{sa.fail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
