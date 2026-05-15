"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Candidate {
  id: number;
  product_slug: string;
  scope: string;
  doc_type: string;
  url: string;
  status: string;
  file_size: number | null;
  page_count: number | null;
  sha256: string | null;
  fetched_at: string | null;
  error: string | null;
}

interface Source {
  id: number;
  product_slug: string;
  scope: string;
  doc_type: string;
  local_path: string;
  url: string | null;
  sha256: string | null;
  page_count: number | null;
  approved_at: string;
  parse_status?: "queued" | "running" | "completed" | "failed" | "none";
  parse_run_id?: number | null;
}

const PARSE_STATUS_PILL: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-200",
  running: "bg-amber-500/15 text-amber-200",
  queued: "bg-amber-500/15 text-amber-200",
  failed: "bg-rose-500/15 text-rose-200",
  none: "bg-amber-500/15 text-amber-200",
};

const PARSE_STATUS_LABEL: Record<string, string> = {
  completed: "parsed",
  running: "parsing",
  queued: "queued",
  failed: "parse failed",
  none: "pending parse",
};

interface ProductContext {
  vendor: string;
  product_line: string;
  category: string;
  slug: string;
  canonical_name: string;
}

const DOC_TYPES = [
  "tech-guide",
  "spec-sheet",
  "data-sheet",
  "admin-guide",
  "support-matrix",
  "platform-intro",
  "brochure",
  "solution-brief",
  "program-doc",
  "other",
];

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SourcesProductView({
  productSlug,
  candidates,
  sources,
  productContext,
}: {
  productSlug: string;
  candidates: Candidate[];
  sources: Source[];
  productContext: ProductContext | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});

  async function loadPreview(id: number) {
    if (previews[id]) return;
    setBusy(`preview-${id}`);
    try {
      const res = await fetch(`/api/pipeline/sources/${id}/screenshot`);
      const json = await res.json();
      if (res.ok && json.dataUrl) {
        setPreviews((p) => ({ ...p, [id]: json.dataUrl }));
      } else {
        setError(String(json?.error ?? `HTTP ${res.status}`));
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  async function findSources() {
    setBusy("find");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/pipeline/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      setMessage(
        `Found ${json.candidatesAdded} candidate(s); ${json.failures?.length ?? 0} failure(s).`
      );
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: number) {
    setBusy(`approve-${id}`);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/pipeline/sources/${id}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      setMessage(`Approved → ${json.localPath}`);
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: number) {
    setBusy(`reject-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/sources/${id}/reject`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    const pending = candidates.filter((c) => c.status === "pending");
    if (!pending.length) return;
    setBusy("approve-all");
    setError(null);
    setMessage(null);
    try {
      let ok = 0;
      let fail = 0;
      for (const c of pending) {
        const res = await fetch(`/api/pipeline/sources/${c.id}/approve`, {
          method: "POST",
        });
        if (res.ok) ok++;
        else fail++;
      }
      setMessage(`Approved ${ok}; failed ${fail}.`);
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={findSources}
          disabled={busy !== null || !productContext}
          className="px-3 py-1.5 rounded bg-white/10 border border-white/20 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {busy === "find" ? "Searching… (may take 1–3 min)" : "Find sources via web search"}
        </button>
        <button
          onClick={approveAll}
          disabled={
            busy !== null ||
            candidates.filter((c) => c.status === "pending").length === 0
          }
          className="px-3 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {busy === "approve-all"
            ? "Approving…"
            : `Approve all pending (${candidates.filter((c) => c.status === "pending").length})`}
        </button>
        {!productContext && (
          <span className="text-xs text-yellow-300">
            Product context could not be resolved — search may fail. Approve product via discovery first.
          </span>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      {message && (
        <div className="text-xs text-emerald-200 border border-emerald-500/40 bg-emerald-500/10 rounded px-2 py-1">
          {message}
        </div>
      )}

      <ManualUploadForm productSlug={productSlug} onUploaded={() => router.refresh()} />

      <section>
        <h2 className="text-sm uppercase tracking-wide text-white/50 mb-2">
          Approved sources ({sources.length})
        </h2>
        {sources.length === 0 ? (
          <div className="panel text-sm text-white/60">No approved sources yet.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>Local path</th>
                  <th className="text-right">Pages</th>
                  <th>Parse</th>
                  <th>Approved</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.04]">
                    <td>
                      <span className="chip">{s.doc_type}</span>
                    </td>
                    <td className="text-xs text-white/60">{s.scope}</td>
                    <td className="font-mono text-xs">{s.local_path}</td>
                    <td className="text-right">{s.page_count ?? "—"}</td>
                    <td>
                      {s.parse_status === "completed" ? (
                        <a
                          href={`/pipeline/parse/${productSlug}`}
                          className={`pill ${PARSE_STATUS_PILL.completed} hover:underline`}
                        >
                          parsed
                        </a>
                      ) : s.parse_status === "failed" ? (
                        <a
                          href={`/pipeline/parse/runs/${s.parse_run_id}`}
                          className={`pill ${PARSE_STATUS_PILL.failed} hover:underline`}
                        >
                          parse failed
                        </a>
                      ) : (
                        <a
                          href={`/pipeline/parse/${productSlug}`}
                          className={`pill ${PARSE_STATUS_PILL[s.parse_status ?? "none"]} hover:underline`}
                        >
                          {PARSE_STATUS_LABEL[s.parse_status ?? "none"]}
                        </a>
                      )}
                    </td>
                    <td className="text-xs text-white/50">{s.approved_at?.slice(0, 19)}</td>
                    <td className="text-xs text-white/50 max-w-[280px] truncate">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-white"
                        >
                          {s.url}
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
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-white/50 mb-2">
          Candidates ({candidates.length})
        </h2>
        {candidates.length === 0 ? (
          <div className="panel text-sm text-white/60">
            No candidates yet. Click &ldquo;Find sources&rdquo; to discover via web search.
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Pages</th>
                  <th>Error</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.04]">
                    <td>
                      <span className="chip">{c.doc_type}</span>
                    </td>
                    <td className="text-xs text-white/60">{c.scope}</td>
                    <td className="text-xs max-w-[400px] truncate">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white/70 hover:text-white"
                      >
                        {c.url}
                      </a>
                    </td>
                    <td>
                      <span className="chip">{c.status}</span>
                    </td>
                    <td className="text-right text-xs">{formatBytes(c.file_size)}</td>
                    <td className="text-right text-xs">{c.page_count ?? "—"}</td>
                    <td className="text-xs text-red-300/80 max-w-[200px] truncate">
                      {c.error ?? ""}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {c.status === "pending" && (
                        <>
                          <button
                            onClick={() => loadPreview(c.id)}
                            disabled={busy !== null || !!previews[c.id]}
                            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:bg-white/10 disabled:opacity-50 mr-1"
                          >
                            {busy === `preview-${c.id}` ? "…" : previews[c.id] ? "Previewed" : "Preview"}
                          </button>
                          <button
                            onClick={() => approve(c.id)}
                            disabled={busy !== null}
                            className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 mr-1"
                          >
                            {busy === `approve-${c.id}` ? "…" : "Approve"}
                          </button>
                          <button
                            onClick={() => reject(c.id)}
                            disabled={busy !== null}
                            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:bg-white/10 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {c.status === "fetch-failed" && (
                        <button
                          onClick={() => reject(c.id)}
                          disabled={busy !== null}
                          className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:bg-white/10 disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {Object.entries(previews).map(([id, dataUrl]) => (
                  <tr key={`prev-${id}`}>
                    <td colSpan={8} className="bg-black/40 p-2 text-xs">
                      <div className="text-white/50 mb-1">Preview for candidate #{id}:</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={dataUrl}
                        alt={`PDF preview ${id}`}
                        className="max-w-md border border-white/10 rounded"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ManualUploadForm({
  productSlug,
  onUploaded,
}: {
  productSlug: string;
  onUploaded: () => void;
}) {
  const [docType, setDocType] = useState("tech-guide");
  const [scope, setScope] = useState("own");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Pick a PDF first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("productSlug", productSlug);
      fd.set("docType", docType);
      fd.set("scope", scope);
      if (url) fd.set("url", url);
      if (title) fd.set("title", title);
      fd.set("file", file);
      const res = await fetch("/api/pipeline/sources/upload", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      setMessage(`Uploaded → ${json.localPath}`);
      setFile(null);
      setUrl("");
      setTitle("");
      onUploaded();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-3">
      <div className="text-sm uppercase tracking-wide text-white/50">Manual upload</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="text-xs text-white/70 space-y-1">
          <div>Doc type</div>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-white/70 space-y-1">
          <div>Scope</div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
          >
            <option value="own">own</option>
            <option value="line">line</option>
            <option value="category">category</option>
          </select>
        </label>
        <label className="text-xs text-white/70 space-y-1">
          <div>URL (optional)</div>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
          />
        </label>
        <label className="text-xs text-white/70 space-y-1">
          <div>Title (optional)</div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <button
          type="submit"
          disabled={busy || !file}
          className="px-3 py-1.5 rounded bg-white/10 border border-white/20 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload PDF"}
        </button>
      </div>
      {error && (
        <div className="text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      {message && (
        <div className="text-xs text-emerald-200 border border-emerald-500/40 bg-emerald-500/10 rounded px-2 py-1">
          {message}
        </div>
      )}
    </form>
  );
}
