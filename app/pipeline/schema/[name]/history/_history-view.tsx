"use client";

/**
 * Client-side history + diff viewer.
 *
 * Pick v1 (left) and v2 (right); fetch unified diff from the API and render
 * it as a colored <pre>. Per-version "Rollback" button POSTs to the rollback
 * endpoint and refreshes the page.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type VersionRow = {
  id: number;
  name: string;
  version: string;
  status: string;
  created_at: string;
  parent_version_id: number | null;
};

type Props = {
  name: string;
  versions: VersionRow[];
};

export default function HistoryView({ name, versions }: Props) {
  const router = useRouter();
  const initialV2 = versions[0]?.version ?? null;
  const initialV1 = versions[1]?.version ?? versions[0]?.version ?? null;
  const [v1, setV1] = useState<string | null>(initialV1);
  const [v2, setV2] = useState<string | null>(initialV2);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!v1 || !v2 || v1 === v2) {
      setDiff("");
      return;
    }
    setLoading(true);
    setErr(null);
    fetch(
      `/api/pipeline/schema/${encodeURIComponent(name)}/diff/${encodeURIComponent(v1)}/${encodeURIComponent(v2)}`,
    )
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setErr(json.error ?? `Diff failed (HTTP ${res.status})`);
          setDiff("");
        } else {
          setDiff(json.unified ?? "");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, v1, v2]);

  async function rollback(target: string) {
    if (!confirm(`Rollback ${name} to ${target}? This creates a new version with the old content.`)) {
      return;
    }
    const res = await fetch(
      `/api/pipeline/schema/${encodeURIComponent(name)}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: target }),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`Rollback failed: ${json.error ?? res.status}\n${(json.errors ?? []).join("\n")}`);
      return;
    }
    router.push(`/pipeline/schema/${name}?saved=${encodeURIComponent(json.version)}`);
  }

  const lines = useMemo(() => diff.split("\n"), [diff]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <aside className="panel">
          <div className="panel-title">All versions ({versions.length})</div>
          <ul className="text-[12px] space-y-1">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-2 py-0.5 border-b border-white/5 last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono">{v.version}</span>
                  <StatusBadge value={v.status} />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setV1(v.version)}
                    className={`text-[10px] rounded px-1.5 py-0.5 border ${
                      v1 === v.version
                        ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                        : "border-white/10 text-white/50 hover:text-white/80"
                    }`}
                  >
                    v1
                  </button>
                  <button
                    type="button"
                    onClick={() => setV2(v.version)}
                    className={`text-[10px] rounded px-1.5 py-0.5 border ${
                      v2 === v.version
                        ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        : "border-white/10 text-white/50 hover:text-white/80"
                    }`}
                  >
                    v2
                  </button>
                  {v.status !== "active" && (
                    <button
                      type="button"
                      onClick={() => rollback(v.version)}
                      className="text-[10px] rounded px-1.5 py-0.5 border border-amber-400/30 text-amber-300 hover:bg-amber-500/10"
                      title="Restore this version (writes new active row)"
                    >
                      rollback
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[12px] text-white/60">
              {v1 && v2 ? (
                <>
                  Diff <span className="font-mono">{v1}</span> →{" "}
                  <span className="font-mono">{v2}</span>
                </>
              ) : (
                <>Pick v1 and v2 from the left panel</>
              )}
            </div>
            {loading && <span className="text-[11px] text-white/40">loading…</span>}
          </div>

          {err && (
            <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-[12px] text-red-200">
              {err}
            </div>
          )}

          {!err && v1 && v2 && v1 === v2 && (
            <div className="text-[12px] text-white/50">Both selectors point at the same version.</div>
          )}

          {!err && v1 && v2 && v1 !== v2 && (
            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words rounded bg-black/40 p-3 max-h-[70vh] overflow-auto">
              {lines.map((line, i) => (
                <DiffLine key={i} line={line} />
              ))}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  let cls = "";
  if (line.startsWith("+++") || line.startsWith("---")) cls = "text-white/40";
  else if (line.startsWith("@@")) cls = "text-amber-300";
  else if (line.startsWith("+")) cls = "text-emerald-300 bg-emerald-500/5";
  else if (line.startsWith("-")) cls = "text-red-300 bg-red-500/5";
  else cls = "text-white/70";
  return (
    <div className={`block ${cls}`}>{line || " "}</div>
  );
}

function StatusBadge({ value }: { value: string }) {
  if (value === "active") return <span className="pill bg-emerald-500/15 text-emerald-300">active</span>;
  if (value === "draft") return <span className="pill bg-amber-500/15 text-amber-300">draft</span>;
  return <span className="pill pill-off">{value}</span>;
}
