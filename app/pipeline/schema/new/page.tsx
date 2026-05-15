"use client";

import { useEffect, useMemo, useState } from "react";

type ReferenceCandidate = {
  path: string;
  bytes: number;
  category: string;
};

type GenerateResponse = {
  schemaId: number;
  name: string;
  version: string;
  content_md: string;
  estimate: {
    systemTokens: number;
    baseTokens: number;
    exampleTokens: number;
    skeletonTokens: number;
    referenceTokens: number;
    totalInputTokens: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
};

export default function NewSchemaWizard() {
  const [category, setCategory] = useState("");
  const [candidates, setCandidates] = useState<ReferenceCandidate[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [skeleton, setSkeleton] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [baseSchema, setBaseSchema] = useState<string>("");

  // Load reference candidate list (a small inline endpoint we add below).
  useEffect(() => {
    fetch("/api/pipeline/schema/generate/candidates")
      .then((r) => (r.ok ? r.json() : { candidates: [], baseSchema: "" }))
      .then((data) => {
        setCandidates(data.candidates ?? []);
        setBaseSchema(data.baseSchema ?? "");
      })
      .catch(() => {
        setCandidates([]);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.path.toLowerCase().includes(q));
  }, [candidates, filter]);

  const pickedPaths = useMemo(
    () => Object.keys(picked).filter((k) => picked[k]),
    [picked]
  );

  const canGenerate =
    category.trim().length > 0 && pickedPaths.length > 0 && !busy;

  async function generate() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pipeline/schema/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: category.trim(),
          referenceMdPaths: pickedPaths,
          skeletonMd: skeleton.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Generation failed");
      } else {
        setResult(json as GenerateResponse);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New schema</h1>
        <p className="text-sm text-white/50 mt-1">
          Bootstrap a brand-new category schema from N reference source MDs. The
          model identifies fields recurring across references and proposes a
          draft following the <code className="font-mono">_base.md</code>{" "}
          conventions. Output routes to the editor for human refinement.
        </p>
      </div>

      {!result && (
        <>
          <section className="panel space-y-3">
            <div className="panel-title">1. Category name</div>
            <p className="text-xs text-white/50">
              Lowercase, hyphenated. Schema-gen refuses to overwrite an existing
              <code className="font-mono mx-1">schemas/{`{category}`}.md</code>
              file — pick a name that does not collide.
            </p>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. fault-tolerant-system, composable-infrastructure"
              className="w-full bg-white/5 border border-white/15 rounded px-3 py-2 text-sm font-mono"
            />
          </section>

          <section className="panel space-y-3">
            <div className="panel-title">
              2. Reference source MDs ({pickedPaths.length} picked)
            </div>
            <p className="text-xs text-white/50">
              Pick 3–5 Reducto-parsed sidecars from products in the
              future-target category. The model walks every one and promotes a
              field into the schema when ≥2 references speak to it.
            </p>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter by path (e.g. server/dell/poweredge/r770)"
              className="w-full bg-white/5 border border-white/15 rounded px-3 py-2 text-sm font-mono"
            />
            <div className="max-h-[360px] overflow-y-auto border border-white/10 rounded">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th className="w-10"></th>
                    <th>Path</th>
                    <th>Category</th>
                    <th className="text-right">KB</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((c) => {
                    const checked = !!picked[c.path];
                    return (
                      <tr
                        key={c.path}
                        onClick={() =>
                          setPicked((p) => ({ ...p, [c.path]: !p[c.path] }))
                        }
                        className={`cursor-pointer ${
                          checked ? "bg-blue-500/10" : "hover:bg-white/[0.04]"
                        }`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPicked((p) => ({
                                ...p,
                                [c.path]: !p[c.path],
                              }))
                            }
                          />
                        </td>
                        <td className="font-mono text-[12px]">{c.path}</td>
                        <td>
                          <span className="chip">{c.category}</span>
                        </td>
                        <td className="text-right text-white/60">
                          {(c.bytes / 1024).toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-white/40 py-6">
                        No matching .md sidecars. Adjust filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && (
              <div className="text-xs text-white/40">
                Showing first 500 of {filtered.length} matches. Refine the
                filter to narrow.
              </div>
            )}
          </section>

          <section className="panel space-y-3">
            <div className="panel-title">3. Skeleton schema (optional)</div>
            <p className="text-xs text-white/50">
              Paste a starting-point schema MD — the model will treat it as a
              skeleton and fill it in. Leave blank to generate from scratch.
            </p>
            <textarea
              value={skeleton}
              onChange={(e) => setSkeleton(e.target.value)}
              placeholder="--- frontmatter --- ... required identity fields ..."
              rows={8}
              className="w-full bg-white/5 border border-white/15 rounded px-3 py-2 text-sm font-mono"
            />
          </section>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={generate}
              className={`px-4 py-2 rounded text-sm font-medium ${
                canGenerate
                  ? "bg-blue-500/20 text-blue-200 border border-blue-400/40 hover:bg-blue-500/30"
                  : "bg-white/5 text-white/40 border border-white/10 cursor-not-allowed"
              }`}
            >
              {busy ? "Generating…" : "Generate draft schema"}
            </button>
            {error && (
              <span className="text-sm text-red-300 font-mono">{error}</span>
            )}
          </div>
        </>
      )}

      {result && (
        <section className="space-y-4">
          <div className="panel">
            <div className="panel-title">Draft generated</div>
            <dl className="kv">
              <dt>Schema name</dt>
              <dd>{result.name}</dd>
              <dt>Version</dt>
              <dd>{result.version}</dd>
              <dt>Schema id</dt>
              <dd>{result.schemaId}</dd>
              <dt>Input / output tokens</dt>
              <dd>
                {result.usage.inputTokens.toLocaleString()} /{" "}
                {result.usage.outputTokens.toLocaleString()}
              </dd>
              <dt>Cache (read / creation)</dt>
              <dd>
                {result.usage.cacheReadTokens.toLocaleString()} /{" "}
                {result.usage.cacheCreationTokens.toLocaleString()}
              </dd>
            </dl>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="panel-title">Generated draft</div>
              <pre className="panel text-[11px] font-mono whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                {result.content_md}
              </pre>
            </div>
            <div>
              <div className="panel-title">_base.md (sanity check)</div>
              <pre className="panel text-[11px] font-mono whitespace-pre-wrap max-h-[600px] overflow-y-auto text-white/60">
                {baseSchema}
              </pre>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`/pipeline/schema/${result.name}/edit`}
              className="px-4 py-2 rounded text-sm font-medium bg-blue-500/20 text-blue-200 border border-blue-400/40 hover:bg-blue-500/30 no-underline"
            >
              Open in editor
            </a>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
              className="px-4 py-2 rounded text-sm border border-white/15 hover:bg-white/5"
            >
              Generate another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
