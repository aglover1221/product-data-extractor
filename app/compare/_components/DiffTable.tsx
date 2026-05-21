"use client";

import { useState } from "react";
import type {
  DiffNode,
  DiffStatus,
  ExtractionDiff,
  RowDiff,
  ScalarDiff,
  SetDiff,
} from "@/lib/pipeline/extraction-diff";

interface Props {
  diff: ExtractionDiff;
}

export default function DiffTable({ diff }: Props) {
  const [collapseUnchanged, setCollapseUnchanged] = useState(true);
  const visible = collapseUnchanged
    ? diff.fields.filter((f) => f.status !== "unchanged")
    : diff.fields;

  return (
    <div className="space-y-4">
      <SummaryBar diff={diff} />
      <div className="flex items-center gap-3 text-xs text-white/60">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={collapseUnchanged}
            onChange={(e) => setCollapseUnchanged(e.target.checked)}
          />
          hide unchanged rows
        </label>
        <span className="text-white/30">·</span>
        <span>{visible.length} of {diff.fields.length} fields shown</span>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-white/40">
            <th className="py-2 px-3 border-b border-white/10 w-10">·</th>
            <th className="py-2 px-3 border-b border-white/10">field</th>
            <th className="py-2 px-3 border-b border-white/10 w-[36%]">{diff.identityLeft.model || "left"}</th>
            <th className="py-2 px-3 border-b border-white/10 w-[36%]">{diff.identityRight.model || "right"}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-white/50">
                {collapseUnchanged ? "No differences — uncheck the box above to see all fields." : "No fields to compare."}
              </td>
            </tr>
          ) : (
            visible.map((node) => <FieldRow key={node.path} node={node} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryBar({ diff }: { diff: ExtractionDiff }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Pill status="changed" count={diff.summary.changed} />
      <Pill status="added" count={diff.summary.added} />
      <Pill status="removed" count={diff.summary.removed} />
      <Pill status="unchanged" count={diff.summary.unchanged} />
    </div>
  );
}

function Pill({ status, count }: { status: DiffStatus; count: number }) {
  return (
    <span className={`px-2 py-0.5 rounded ${pillCls(status)}`}>
      {label(status)}: <span className="font-mono">{count}</span>
    </span>
  );
}

function FieldRow({ node }: { node: DiffNode }) {
  if (node.kind === "scalar") return <ScalarRow node={node} />;
  if (node.kind === "set") return <SetRow node={node} />;
  return <RowGroup node={node} />;
}

function ScalarRow({ node }: { node: ScalarDiff }) {
  const [open, setOpen] = useState(false);
  const hasEvidence = !!(node.evidenceLeft || node.evidenceRight);
  return (
    <>
      <tr className={rowCls(node.status)}>
        <td className="py-2 px-3 align-top">
          <StatusGlyph status={node.status} />
        </td>
        <td className="py-2 px-3 align-top">
          <div className="font-mono text-xs text-white/80">{node.path}</div>
          {node.confidenceDelta !== null && Math.abs(node.confidenceDelta) > 0.01 ? (
            <div className="text-[10px] mt-1 text-white/40">
              Δconfidence: {fmtDelta(node.confidenceDelta)}
            </div>
          ) : null}
        </td>
        <td className="py-2 px-3 align-top text-white/90">{renderValue(node.left)}</td>
        <td className="py-2 px-3 align-top text-white/90">
          <div className="flex items-start justify-between gap-2">
            <span>{renderValue(node.right)}</span>
            {hasEvidence ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/80"
              >
                {open ? "hide" : "evidence"}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {open && hasEvidence ? (
        <tr className="bg-white/[0.02]">
          <td colSpan={4} className="py-2 px-3">
            <EvidencePair left={node.evidenceLeft} right={node.evidenceRight} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SetRow({ node }: { node: SetDiff }) {
  return (
    <tr className={rowCls(node.status)}>
      <td className="py-2 px-3 align-top">
        <StatusGlyph status={node.status} />
      </td>
      <td className="py-2 px-3 align-top">
        <div className="font-mono text-xs text-white/80">{node.path}</div>
        <div className="text-[10px] mt-1 text-white/40">set</div>
      </td>
      <td className="py-2 px-3 align-top text-white/90">{renderList(node.left)}</td>
      <td className="py-2 px-3 align-top text-white/90 space-y-1">
        <div>{renderList(node.right)}</div>
        {node.added.length > 0 ? (
          <div className="text-[10px] text-emerald-300/80">+ {node.added.map(renderValue).join(", ")}</div>
        ) : null}
        {node.removed.length > 0 ? (
          <div className="text-[10px] text-rose-300/80">− {node.removed.map(renderValue).join(", ")}</div>
        ) : null}
      </td>
    </tr>
  );
}

function RowGroup({ node }: { node: RowDiff }) {
  const [open, setOpen] = useState(node.status !== "unchanged");
  return (
    <>
      <tr className={rowCls(node.status)}>
        <td className="py-2 px-3 align-top">
          <StatusGlyph status={node.status} />
        </td>
        <td className="py-2 px-3 align-top">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-left"
          >
            <div className="font-mono text-xs text-white/80">{node.path}</div>
            <div className="text-[10px] mt-1 text-white/40">
              keyed-list ({node.rowKey}) · {node.fields.length} rows · click to {open ? "collapse" : "expand"}
            </div>
          </button>
        </td>
        <td className="py-2 px-3 align-top text-white/60 text-xs">
          {node.fields.filter((f) => f.status === "removed").length} removed
        </td>
        <td className="py-2 px-3 align-top text-white/60 text-xs">
          {node.fields.filter((f) => f.status === "added").length} added ·{" "}
          {node.fields.filter((f) => f.status === "changed").length} changed
        </td>
      </tr>
      {open
        ? node.fields
            .filter((c) => c.status !== "unchanged" || node.status === "unchanged")
            .map((child) => <FieldRow key={child.path} node={child} />)
        : null}
    </>
  );
}

function EvidencePair({
  left,
  right,
}: {
  left: { source?: string; page?: number; quote?: string; confidence?: number } | null;
  right: { source?: string; page?: number; quote?: string; confidence?: number } | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
      <EvidenceCell side="left" e={left} />
      <EvidenceCell side="right" e={right} />
    </div>
  );
}

function EvidenceCell({
  side,
  e,
}: {
  side: "left" | "right";
  e: { source?: string; page?: number; quote?: string; confidence?: number } | null;
}) {
  if (!e) {
    return (
      <div className="rounded bg-white/[0.03] p-2 text-white/40 italic">no evidence ({side})</div>
    );
  }
  return (
    <div className="rounded bg-white/[0.03] p-2 space-y-1">
      <div className="font-mono text-[11px] text-white/60">
        {e.source ?? "—"}
        {typeof e.page === "number" ? ` · p${e.page}` : ""}
        {typeof e.confidence === "number" ? ` · ${(e.confidence * 100).toFixed(0)}%` : ""}
      </div>
      {e.quote ? <div className="italic text-white/80">"{e.quote}"</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Render primitives
// ----------------------------------------------------------------------------

function renderValue(v: unknown): string {
  if (v === null) return "—";
  if (v === undefined) return "—";
  if (typeof v === "string") return v.length > 0 ? v : `""`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length} items]`;
  return JSON.stringify(v);
}

function renderList(items: unknown[]): string {
  if (items.length === 0) return "[]";
  return items.map(renderValue).join(", ");
}

function StatusGlyph({ status }: { status: DiffStatus }) {
  const map: Record<DiffStatus, string> = {
    unchanged: "·",
    changed: "≠",
    added: "+",
    removed: "−",
  };
  return (
    <span className={`inline-block w-5 text-center font-mono text-base ${glyphCls(status)}`}>
      {map[status]}
    </span>
  );
}

function rowCls(status: DiffStatus): string {
  if (status === "unchanged") return "border-b border-white/5";
  return "border-b border-white/10 hover:bg-white/[0.02]";
}

function pillCls(status: DiffStatus): string {
  switch (status) {
    case "changed": return "bg-amber-500/10 text-amber-200 border border-amber-500/20";
    case "added": return "bg-emerald-500/10 text-emerald-200 border border-emerald-500/20";
    case "removed": return "bg-rose-500/10 text-rose-200 border border-rose-500/20";
    case "unchanged": return "bg-white/[0.04] text-white/60 border border-white/10";
  }
}

function glyphCls(status: DiffStatus): string {
  switch (status) {
    case "changed": return "text-amber-300";
    case "added": return "text-emerald-300";
    case "removed": return "text-rose-300";
    case "unchanged": return "text-white/30";
  }
}

function label(status: DiffStatus): string {
  switch (status) {
    case "changed": return "changed";
    case "added": return "added";
    case "removed": return "removed";
    case "unchanged": return "unchanged";
  }
}

function fmtDelta(d: number): string {
  const sign = d > 0 ? "+" : d < 0 ? "" : "";
  return `${sign}${d.toFixed(2)}`;
}
