/**
 * Pure pairwise diff for two `extraction.json` trees.
 *
 * The viewer's /compare page calls this to render side-by-side deltas with
 * per-value evidence preserved. The function is intentionally I/O-free so
 * it stays trivially testable.
 *
 * Shape rules (mirroring lib/extractions.ts):
 *   - Most leaf fields are `{ value, evidence }` blocks. Scalars at the top
 *     level (vendor, slug, model, category, product_line, description) are
 *     compared raw.
 *   - `extraction_metadata` is informational, not a value-bearing field —
 *     it's surfaced separately as a context block, never as diff rows.
 *   - Arrays of records (cpu_skus, pcie_slots, riser_configs, ...) are
 *     keyed by `slug ?? id ?? sku ?? name`, with positional fallback when
 *     none of those keys are present.
 *   - Arrays of scalars (workload_tags.value, processor_family.value, ...)
 *     are compared as sets for added/removed and as a single row for the
 *     overall list when nothing keyed matches.
 */
import type { Extraction, Evidence } from "@/lib/extractions";

export type DiffStatus = "unchanged" | "added" | "removed" | "changed";

export interface ScalarDiff {
  kind: "scalar";
  path: string;
  status: DiffStatus;
  left: unknown;
  right: unknown;
  evidenceLeft: Evidence | null;
  evidenceRight: Evidence | null;
  confidenceDelta: number | null;
}

export interface SetDiff {
  kind: "set";
  path: string;
  status: DiffStatus;
  left: unknown[];
  right: unknown[];
  added: unknown[];
  removed: unknown[];
  evidenceLeft: Evidence | null;
  evidenceRight: Evidence | null;
}

export interface RowDiff {
  kind: "row";
  path: string;
  status: DiffStatus;
  /** Stable key identifying the row across both sides. */
  rowKey: string;
  /** Per-field deltas inside this row. Only populated when status='changed'. */
  fields: DiffNode[];
  /** Full record on each side, for context. */
  leftRecord: Record<string, unknown> | null;
  rightRecord: Record<string, unknown> | null;
}

export type DiffNode = ScalarDiff | SetDiff | RowDiff;

export interface ExtractionDiff {
  /** Top-level identity context — vendor/slug/category etc. */
  identityLeft: ExtractionIdentity;
  identityRight: ExtractionIdentity;
  /** Field-level diffs, ordered by first appearance in the left extraction. */
  fields: DiffNode[];
  /** Aggregate counters for the diff table header. */
  summary: DiffSummary;
}

export interface ExtractionIdentity {
  vendor: string;
  category: string;
  product_line: string;
  slug: string;
  model: string;
  schema_version: string | null;
  extracted_at: string | null;
}

export interface DiffSummary {
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
}

// ----------------------------------------------------------------------------
// Top-level entry point
// ----------------------------------------------------------------------------

const IDENTITY_KEYS = new Set([
  "vendor",
  "category",
  "subcategory",
  "product_line",
  "slug",
  "model",
  "description",
  "overlays",
  "extraction_metadata",
  "sources",
]);

export function diffExtractions(left: Extraction, right: Extraction): ExtractionDiff {
  const fieldKeys = unionOrderedKeys(left, right, (k) => !IDENTITY_KEYS.has(k));
  const fields: DiffNode[] = [];
  for (const key of fieldKeys) {
    const node = diffField(key, (left as any)[key], (right as any)[key]);
    if (node) fields.push(node);
  }
  return {
    identityLeft: readIdentity(left),
    identityRight: readIdentity(right),
    fields,
    summary: summarize(fields),
  };
}

function readIdentity(d: Extraction): ExtractionIdentity {
  return {
    vendor: unwrap<string>(d.vendor) ?? "",
    category: unwrap<string>(d.category) ?? "",
    product_line: unwrap<string>(d.product_line) ?? "",
    slug: unwrap<string>(d.slug) ?? "",
    model: unwrap<string>(d.model) ?? "",
    schema_version: d.extraction_metadata?.schema_version ?? null,
    extracted_at: d.extraction_metadata?.extracted_at ?? null,
  };
}

// ----------------------------------------------------------------------------
// Field dispatch
// ----------------------------------------------------------------------------

function diffField(path: string, a: unknown, b: unknown): DiffNode | null {
  // Missing on either side — short-circuit. Genuinely-absent fields skip
  // the set/array/scalar machinery entirely.
  if (a === undefined && b === undefined) return null;
  if (a === undefined) return makeRemoteOnly(path, b, "added");
  if (b === undefined) return makeRemoteOnly(path, a, "removed");

  // Plain scalars (top-level identity-adjacent strings we let through).
  if (!isValueWrapper(a) && !isValueWrapper(b) && !Array.isArray(a) && !Array.isArray(b)) {
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
      return rawScalar(path, a, b);
    }
  }

  // Array-of-records vs array-of-scalars: peek at the first element of either side.
  const aArr = arrayOfWrapperValue(a);
  const bArr = arrayOfWrapperValue(b);
  if (aArr !== null || bArr !== null) {
    const aa = aArr ?? [];
    const bb = bArr ?? [];
    if (looksLikeRecordList(aa) || looksLikeRecordList(bb)) {
      return diffRowList(path, aa, bb);
    }
    return diffScalarSet(path, aa, bb, evidenceOf(a), evidenceOf(b));
  }

  // {value, evidence} wrapper — the common case.
  const va = isValueWrapper(a) ? (a as any).value : a;
  const vb = isValueWrapper(b) ? (b as any).value : b;
  const ea = evidenceOf(a);
  const eb = evidenceOf(b);
  return wrappedScalar(path, va, vb, ea, eb);
}

function makeRemoteOnly(path: string, present: unknown, status: "added" | "removed"): DiffNode {
  if (isValueWrapper(present)) {
    return {
      kind: "scalar",
      path,
      status,
      left: status === "removed" ? (present as any).value : undefined,
      right: status === "added" ? (present as any).value : undefined,
      evidenceLeft: status === "removed" ? evidenceOf(present) : null,
      evidenceRight: status === "added" ? evidenceOf(present) : null,
      confidenceDelta: null,
    };
  }
  if (Array.isArray(present)) {
    return {
      kind: "set",
      path,
      status,
      left: status === "removed" ? present : [],
      right: status === "added" ? present : [],
      added: status === "added" ? present : [],
      removed: status === "removed" ? present : [],
      evidenceLeft: null,
      evidenceRight: null,
    };
  }
  return {
    kind: "scalar",
    path,
    status,
    left: status === "removed" ? present : undefined,
    right: status === "added" ? present : undefined,
    evidenceLeft: null,
    evidenceRight: null,
    confidenceDelta: null,
  };
}

// ----------------------------------------------------------------------------
// Scalar comparison
// ----------------------------------------------------------------------------

function rawScalar(path: string, a: unknown, b: unknown): ScalarDiff {
  const equal = scalarsEqual(a, b);
  return {
    kind: "scalar",
    path,
    status: equal ? "unchanged" : "changed",
    left: a,
    right: b,
    evidenceLeft: null,
    evidenceRight: null,
    confidenceDelta: null,
  };
}

function wrappedScalar(
  path: string,
  a: unknown,
  b: unknown,
  ea: Evidence | null,
  eb: Evidence | null
): ScalarDiff {
  const equal = scalarsEqual(a, b);
  const ca = typeof ea?.confidence === "number" ? ea.confidence : null;
  const cb = typeof eb?.confidence === "number" ? eb.confidence : null;
  const confidenceDelta = ca !== null && cb !== null ? +(cb - ca).toFixed(4) : null;
  return {
    kind: "scalar",
    path,
    status: equal ? "unchanged" : "changed",
    left: a,
    right: b,
    evidenceLeft: ea,
    evidenceRight: eb,
    confidenceDelta,
  };
}

function scalarsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => scalarsEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    // Defensive equality on nested objects — exact-shape match required.
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
    return ak.every((k) => scalarsEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

// ----------------------------------------------------------------------------
// Set diff (arrays of scalars)
// ----------------------------------------------------------------------------

function diffScalarSet(
  path: string,
  a: unknown[],
  b: unknown[],
  ea: Evidence | null,
  eb: Evidence | null
): SetDiff {
  const aSet = new Set(a.map(stableJson));
  const bSet = new Set(b.map(stableJson));
  const added: unknown[] = [];
  const removed: unknown[] = [];
  for (const item of b) {
    if (!aSet.has(stableJson(item))) added.push(item);
  }
  for (const item of a) {
    if (!bSet.has(stableJson(item))) removed.push(item);
  }
  let status: DiffStatus = "unchanged";
  if (added.length > 0 || removed.length > 0) status = "changed";
  return {
    kind: "set",
    path,
    status,
    left: a,
    right: b,
    added,
    removed,
    evidenceLeft: ea,
    evidenceRight: eb,
  };
}

// ----------------------------------------------------------------------------
// Row diff (arrays of records keyed by slug/id/sku/name)
// ----------------------------------------------------------------------------

const ROW_KEY_PREFERENCE = ["slug", "id", "sku", "name", "code"];

function diffRowList(path: string, a: unknown[], b: unknown[]): DiffNode {
  const keyField = pickRowKeyField(a, b);
  const aMap = indexRows(a, keyField);
  const bMap = indexRows(b, keyField);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const k of aMap.keys()) { ordered.push(k); seen.add(k); }
  for (const k of bMap.keys()) { if (!seen.has(k)) ordered.push(k); }

  const rowDiffs: DiffNode[] = [];
  for (const rowKey of ordered) {
    const left = aMap.get(rowKey) ?? null;
    const right = bMap.get(rowKey) ?? null;
    rowDiffs.push(diffSingleRow(`${path}[${rowKey}]`, rowKey, left, right));
  }

  // Aggregate into one parent SetDiff-like wrapper using the row kind itself
  // so the consumer can render groups. We return the parent as a synthetic
  // "row" entry with status='changed' iff any child changed.
  const anyDelta = rowDiffs.some((r) => r.status !== "unchanged");
  return {
    kind: "row",
    path,
    status: anyDelta ? "changed" : "unchanged",
    rowKey: keyField ?? "(positional)",
    fields: rowDiffs,
    leftRecord: null,
    rightRecord: null,
  };
}

function diffSingleRow(
  path: string,
  rowKey: string,
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
): RowDiff {
  if (left === null && right !== null) {
    return {
      kind: "row",
      path,
      status: "added",
      rowKey,
      fields: [],
      leftRecord: null,
      rightRecord: right,
    };
  }
  if (right === null && left !== null) {
    return {
      kind: "row",
      path,
      status: "removed",
      rowKey,
      fields: [],
      leftRecord: left,
      rightRecord: null,
    };
  }
  if (!left || !right) {
    return {
      kind: "row", path, status: "unchanged", rowKey, fields: [], leftRecord: null, rightRecord: null
    };
  }
  const keys = unionOrderedKeys(left, right);
  const fieldDeltas: DiffNode[] = [];
  for (const k of keys) {
    const child = diffField(`${path}.${k}`, left[k], right[k]);
    if (child) fieldDeltas.push(child);
  }
  const anyDelta = fieldDeltas.some((f) => f.status !== "unchanged");
  return {
    kind: "row",
    path,
    status: anyDelta ? "changed" : "unchanged",
    rowKey,
    fields: fieldDeltas,
    leftRecord: left,
    rightRecord: right,
  };
}

function pickRowKeyField(a: unknown[], b: unknown[]): string | null {
  const sample = (a.length > 0 ? a : b)[0];
  if (!sample || typeof sample !== "object") return null;
  const keys = Object.keys(sample as object);
  for (const candidate of ROW_KEY_PREFERENCE) {
    if (keys.includes(candidate)) return candidate;
  }
  return null;
}

function indexRows(rows: unknown[], keyField: string | null): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  rows.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    const r = row as Record<string, unknown>;
    const rawKey = keyField ? r[keyField] : null;
    const key =
      typeof rawKey === "string" && rawKey.length > 0
        ? rawKey
        : typeof rawKey === "number"
          ? String(rawKey)
          : `#${idx}`;
    if (!out.has(key)) out.set(key, r);
  });
  return out;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function unionOrderedKeys(
  a: object,
  b: object,
  filter: (k: string) => boolean = () => true
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of Object.keys(a ?? {})) {
    if (!filter(k)) continue;
    if (!seen.has(k)) { out.push(k); seen.add(k); }
  }
  for (const k of Object.keys(b ?? {})) {
    if (!filter(k)) continue;
    if (!seen.has(k)) { out.push(k); seen.add(k); }
  }
  return out;
}

function isValueWrapper(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "value" in (v as object)
  );
}

function evidenceOf(v: unknown): Evidence | null {
  if (v === null || typeof v !== "object") return null;
  const ev = (v as any).evidence;
  if (!ev || typeof ev !== "object") return null;
  return ev as Evidence;
}

function arrayOfWrapperValue(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (isValueWrapper(v)) {
    const inner = (v as any).value;
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

function looksLikeRecordList(arr: unknown[]): boolean {
  if (arr.length === 0) return false;
  const first = arr[0];
  return first !== null && typeof first === "object" && !Array.isArray(first);
}

function unwrap<T = unknown>(field: unknown): T | null {
  if (field == null) return null;
  if (typeof field === "object" && field !== null && "value" in (field as object)) {
    return (field as { value: T }).value;
  }
  return field as T;
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const keys = Object.keys(v as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`;
}

function summarize(fields: DiffNode[]): DiffSummary {
  const s: DiffSummary = { unchanged: 0, changed: 0, added: 0, removed: 0 };
  for (const f of fields) {
    s[f.status]++;
    if (f.kind === "row" && f.status === "changed") {
      // Descend so the summary reflects per-cell churn, not just top-level counts.
      for (const child of f.fields) {
        if (child.status === "changed" || child.status === "added" || child.status === "removed") {
          s[child.status]++;
        }
      }
    }
  }
  return s;
}
