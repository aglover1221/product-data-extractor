"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProposedProduct {
  slug: string;
  model_number: string;
  marketing_name: string;
  evidence_anchor?: string | null;
  evidence_quote?: string | null;
  confidence: number;
}

interface PreviewResult {
  ctx: { category: string; vendor: string; productLine: string };
  products: ProposedProduct[];
  low_confidence: (ProposedProduct & { reason?: string | null })[];
  notes: string;
  alreadyExists: string[];
  approvable: ProposedProduct[];
  bodyTruncated: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface Props {
  /** Manifest-relative path to the parsed sidecar (e.g. ../source/n3200-on-spec-sheet.md). */
  sidecarPath: string;
  /** Display label (filename, etc.). */
  label: string;
  /** Disabled when the sidecar isn't parsed yet. */
  disabled?: boolean;
}

export default function ExtractProductsButton({
  sidecarPath,
  label,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{ created: string[]; skipped: string[] } | null>(null);

  async function runPreview() {
    setLoading(true);
    setError(null);
    setPreview(null);
    setCommitted(null);
    try {
      const res = await fetch("/api/pipeline/extract-products-from-source/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: sidecarPath }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(String(json?.error ?? `HTTP ${res.status}`));
      }
      setPreview(json);
      // Pre-select all approvable (≥0.7 confidence and not already on disk).
      setSelected(new Set(json.approvable.map((p: ProposedProduct) => p.slug)));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const slugs = Array.from(selected);
      const res = await fetch("/api/pipeline/extract-products-from-source/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: sidecarPath,
          slugs,
          proposed: preview.products,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(String(json?.error ?? `HTTP ${res.status}`));
      }
      setCommitted({
        created: (json.created ?? []).map((c: any) => c.slug),
        skipped: (json.skipped ?? []).map((c: any) => c.slug),
      });
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setCommitting(false);
    }
  }

  function toggle(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setSelected(next);
  }

  function close() {
    setOpen(false);
    setPreview(null);
    setError(null);
    setCommitted(null);
    setSelected(new Set());
  }

  return (
    <>
      <button
        className="text-[11px] px-2 py-1 rounded border border-emerald-400/30 bg-emerald-500/5 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={disabled}
        title={
          disabled
            ? "Parse the source first to enable product extraction"
            : `Extract products mentioned in ${label}`
        }
        onClick={() => {
          setOpen(true);
          if (!preview && !committed) runPreview();
        }}
      >
        ✦ Extract products
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-8 overflow-y-auto"
          onClick={close}
        >
          <div
            className="bg-neutral-950 border border-white/10 rounded-lg max-w-3xl w-full p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/40">
                  Extract products
                </div>
                <div className="text-sm font-mono text-white/80">{label}</div>
              </div>
              <button
                className="text-white/50 hover:text-white"
                onClick={close}
              >
                ✕
              </button>
            </div>

            {loading && (
              <div className="text-sm text-white/60">
                Scanning sidecar via Claude Opus… typically 5-15s.
              </div>
            )}

            {error && (
              <div className="text-sm text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-3 py-2">
                {error}
              </div>
            )}

            {preview && !committed && (
              <>
                <div className="text-xs text-white/50 flex items-center gap-3 flex-wrap">
                  <span>{preview.ctx.category} · {preview.ctx.vendor} · {preview.ctx.productLine}</span>
                  <span className="text-white/30">·</span>
                  <span>${preview.costUsd.toFixed(4)} ({preview.inputTokens.toLocaleString()} → {preview.outputTokens.toLocaleString()} tok)</span>
                  {preview.bodyTruncated && (
                    <span className="text-amber-300">truncated</span>
                  )}
                </div>

                {preview.products.length === 0 ? (
                  <div className="text-sm text-white/60">
                    No products detected. {preview.notes && <em>{preview.notes}</em>}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-white/40">
                      Proposed products ({preview.products.length})
                    </div>
                    <table className="data-table text-[12px]">
                      <thead>
                        <tr>
                          <th className="w-8"></th>
                          <th>Slug</th>
                          <th>Model</th>
                          <th className="w-16 text-right">Conf</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.products.map(p => {
                          const exists = preview.alreadyExists.includes(p.slug);
                          const checked = selected.has(p.slug);
                          return (
                            <tr key={p.slug} className={exists ? "opacity-50" : ""}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={exists}
                                  onChange={() => toggle(p.slug)}
                                />
                              </td>
                              <td className="font-mono">{p.slug}</td>
                              <td>{p.marketing_name || p.model_number}</td>
                              <td className="text-right tabular-nums">
                                {p.confidence.toFixed(2)}
                              </td>
                              <td className="text-[11px] text-white/40">
                                {exists ? "exists" : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {preview.low_confidence.length > 0 && (
                  <details className="text-[11px]">
                    <summary className="text-white/40 cursor-pointer">
                      Low-confidence ({preview.low_confidence.length}) — not selected by default
                    </summary>
                    <ul className="mt-1.5 space-y-1 text-white/50">
                      {preview.low_confidence.map(p => (
                        <li key={p.slug}>
                          <span className="font-mono">{p.slug}</span>
                          {" — "}
                          <span>{p.marketing_name || p.model_number}</span>
                          {p.reason && <span className="text-white/30"> · {p.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    className="text-[12px] px-3 py-1.5 rounded text-white/60 hover:text-white"
                    onClick={close}
                  >
                    Cancel
                  </button>
                  <button
                    className="text-[12px] px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                    disabled={committing || selected.size === 0}
                    onClick={commit}
                  >
                    {committing
                      ? "Creating…"
                      : `Create ${selected.size} product MD${selected.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}

            {committed && (
              <div className="space-y-2 text-sm">
                <div className="text-emerald-200">
                  Created {committed.created.length} product MD{committed.created.length === 1 ? "" : "s"}.
                </div>
                {committed.created.length > 0 && (
                  <ul className="text-[12px] text-white/70 list-disc list-inside">
                    {committed.created.map(s => (
                      <li key={s}>
                        <span className="font-mono">{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {committed.skipped.length > 0 && (
                  <div className="text-[12px] text-white/40">
                    Skipped: {committed.skipped.join(", ")}
                  </div>
                )}
                <div className="flex justify-end pt-2 border-t border-white/5">
                  <button
                    className="text-[12px] px-3 py-1.5 rounded text-white/60 hover:text-white"
                    onClick={close}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
