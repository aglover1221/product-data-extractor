"use client";

/**
 * SchemaEditor — split MD editor with CodeMirror 6 (markdown mode).
 *
 * Left:  CodeMirror 6 editing the raw schema MD.
 * Right: rendered preview via react-markdown + remark-gfm (matches viewer style).
 *
 * Save: POSTs to /api/pipeline/schema/save. On success → redirect to detail page
 * with a query param triggering the post-save banner (diff link + re-extract CTA).
 *
 * On validation rejection (422), renders the error list inline; the editor stays open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

type Props = {
  name: string;
  initialContent: string;
  parentVersion: string | null;
};

export default function SchemaEditor({ name, initialContent, parentVersion }: Props) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Initialize CodeMirror once
  useEffect(() => {
    if (!editorRef.current) return;
    if (viewRef.current) return;
    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setContent(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = new EditorView({ state, parent: editorRef.current });
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    setErrors([]);
    setSavedVersion(null);
    try {
      const res = await fetch("/api/pipeline/schema/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content_md: content, parentVersion }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(json.errors) && json.errors.length) {
          setErrors(json.errors);
        } else {
          setErrors([json.error ?? `Save failed (HTTP ${res.status})`]);
        }
        setSaving(false);
        return;
      }
      setSavedVersion(json.version);
      // Route to detail page; pass the new version as a query param so the page
      // can render a "saved successfully" banner with a "Re-extract affected" CTA.
      router.push(`/pipeline/schema/${name}?saved=${encodeURIComponent(json.version)}`);
    } catch (e: any) {
      setErrors([e?.message ?? String(e)]);
      setSaving(false);
    }
  }, [content, name, parentVersion, router]);

  const dirty = useMemo(() => content !== initialContent, [content, initialContent]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-white/60">
          {dirty ? (
            <span className="text-amber-300/80">unsaved changes</span>
          ) : (
            <span className="text-white/40">no changes</span>
          )}
          {parentVersion && (
            <span className="ml-3 font-mono">parent: {parentVersion}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={onSave}
            className="rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[12px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save & bump version"}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-red-400/40 bg-red-500/10 p-3 text-[12px] text-red-200">
          <div className="font-medium mb-1">Validation failed</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {savedVersion && (
        <div className="rounded border border-emerald-400/40 bg-emerald-500/10 p-3 text-[12px] text-emerald-200">
          Saved as <span className="font-mono">{savedVersion}</span>. Routing…
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel p-0 overflow-hidden">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] uppercase tracking-wider text-white/50">
            source · markdown
          </div>
          <div ref={editorRef} className="cm-host" />
        </div>
        <div className="panel overflow-auto max-h-[80vh]">
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-2">
            preview
          </div>
          <div className="md-preview text-[13px] text-white/80 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .cm-host .cm-editor {
          min-height: 60vh;
          font-size: 12px;
        }
        .cm-host .cm-scroller {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
      `}</style>
    </div>
  );
}
