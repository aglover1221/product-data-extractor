"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type AnnotationType = "flag" | "note";
type AnnotationStatus = "open" | "resolved" | "wont-fix";

export type Annotation = {
  id: string;
  field_path: string;
  type: AnnotationType;
  text: string;
  created_at: string;
  status: AnnotationStatus;
  resolution_summary: string | null;
  resolved_at: string | null;
};

export default function AnnotationButton({
  slug,
  fieldPath,
  annotations
}: {
  slug: string;
  fieldPath: string;
  annotations: Annotation[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AnnotationType>("flag");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const POPOVER_WIDTH = 320; // tailwind w-80
    const MARGIN = 8;
    function place() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = rect.left;
      if (left + POPOVER_WIDTH + MARGIN > vw) {
        left = Math.max(MARGIN, vw - POPOVER_WIDTH - MARGIN);
      }
      setCoords({ top: rect.bottom + 4, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openCount = annotations.filter((a) => a.status === "open").length;
  const totalCount = annotations.length;
  const hasOpen = openCount > 0;

  async function call(method: "POST" | "PATCH" | "DELETE", body?: any, qs?: string) {
    const url = `/api/annotations/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `${method} failed: ${res.status}`);
    }
    return res.json().catch(() => ({}));
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await call("POST", { field_path: fieldPath, type, text: text.trim() });
      setText("");
      router.refresh();
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: AnnotationStatus) {
    setBusy(true);
    try {
      await call("PATCH", { id, status });
      router.refresh();
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this annotation?")) return;
    setBusy(true);
    try {
      await call("DELETE", undefined, `id=${encodeURIComponent(id)}`);
      router.refresh();
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Button color by state:
  // - has open flag → amber
  // - has open note (no flag) → blue
  // - has only resolved/wont-fix → muted with count
  // - none → ghost
  const hasOpenFlag = annotations.some((a) => a.status === "open" && a.type === "flag");
  const hasOpenNote = annotations.some((a) => a.status === "open" && a.type === "note");
  const buttonClass = hasOpenFlag
    ? "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30"
    : hasOpenNote
    ? "bg-blue-400/20 text-blue-300 hover:bg-blue-400/30"
    : totalCount > 0
    ? "text-white/40 hover:text-white/60 hover:bg-white/5 border border-white/10"
    : "text-white/20 hover:text-white/50 hover:bg-white/5";

  const popover = open && coords && mounted ? createPortal(
    (
      <div
        ref={popoverRef}
        style={{ position: "fixed", top: coords.top, left: coords.left }}
        className="z-50 w-80 bg-zinc-900 border border-white/10 rounded-md shadow-xl p-3 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
          <div className="text-[10px] uppercase tracking-wider text-white/50 mb-2 font-mono">
            {fieldPath}
          </div>
          {annotations.length > 0 && (
            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
              {annotations.map((a) => (
                <div
                  key={a.id}
                  className={`border-l-2 pl-2 py-1 ${
                    a.status === "open"
                      ? a.type === "flag"
                        ? "border-amber-400/60"
                        : "border-blue-400/60"
                      : "border-white/15 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`text-[9px] uppercase tracking-wider px-1 rounded ${
                        a.type === "flag"
                          ? "bg-amber-400/20 text-amber-300"
                          : "bg-blue-400/20 text-blue-300"
                      }`}
                    >
                      {a.type === "flag" ? "review" : "note"}
                    </span>
                    <span className="text-[9px] text-white/40">
                      {a.status} · {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-white/85 whitespace-pre-wrap text-[11px] leading-snug">
                    {a.text}
                  </div>
                  {a.resolution_summary && (
                    <div className="text-[10px] text-white/55 mt-1 italic">
                      → {a.resolution_summary}
                    </div>
                  )}
                  <div className="flex gap-2 mt-1.5 items-center">
                    {a.status === "open" ? (
                      <>
                        <button
                          className="text-[10px] text-emerald-300/80 hover:text-emerald-200"
                          onClick={() => setStatus(a.id, "resolved")}
                          disabled={busy}
                        >
                          mark resolved
                        </button>
                        <button
                          className="text-[10px] text-white/50 hover:text-white/80"
                          onClick={() => setStatus(a.id, "wont-fix")}
                          disabled={busy}
                        >
                          won&apos;t fix
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-[10px] text-white/50 hover:text-white/80"
                        onClick={() => setStatus(a.id, "open")}
                        disabled={busy}
                      >
                        reopen
                      </button>
                    )}
                    <button
                      className="text-[10px] text-rose-400/70 hover:text-rose-300 ml-auto"
                      onClick={() => remove(a.id)}
                      disabled={busy}
                    >
                      delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <div className="flex gap-3 text-[10px]">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`type-${fieldPath}`}
                  value="flag"
                  checked={type === "flag"}
                  onChange={() => setType("flag")}
                />
                <span className="uppercase tracking-wider">Flag for review</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`type-${fieldPath}`}
                  value="note"
                  checked={type === "note"}
                  onChange={() => setType("note")}
                />
                <span className="uppercase tracking-wider">Note</span>
              </label>
            </div>
            <textarea
              className="w-full bg-zinc-950 border border-white/10 rounded px-2 py-1.5 text-[11px] resize-y min-h-[60px] focus:outline-none focus:border-white/30"
              placeholder={
                type === "flag"
                  ? "Reasoning for review (your read; not assumed correct)"
                  : "FYI / context for later"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex justify-between items-center">
              <button
                type="button"
                className="text-[10px] text-white/50 hover:text-white/80"
                onClick={() => setOpen(false)}
              >
                cancel
              </button>
              <button
                type="button"
                className="text-[11px] bg-white/10 hover:bg-white/20 px-3 py-1 rounded disabled:opacity-50"
                onClick={submit}
                disabled={busy || !text.trim()}
              >
                save
              </button>
            </div>
          </div>
        </div>
    ),
    document.body
  ) : null;

  return (
    <span className="inline-block ml-1.5 align-middle">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center justify-center text-[10px] leading-none px-1 min-w-4 h-4 rounded transition ${buttonClass}`}
        title={
          hasOpen
            ? `${openCount} open · ${totalCount} total — click to view/add`
            : totalCount > 0
            ? `${totalCount} resolved — click to view`
            : "Add annotation"
        }
      >
        {totalCount > 0 ? totalCount : "⚐"}
      </button>
      {popover}
    </span>
  );
}
