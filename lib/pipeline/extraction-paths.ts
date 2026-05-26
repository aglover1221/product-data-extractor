/**
 * Helpers for reading/writing fields in extraction.json by dotted/bracketed path.
 *
 * Field paths follow the spot-fix-extraction skill convention:
 *   - Top-level scalar:    `socket_count`              → root.socket_count
 *   - Top-level list:      `processor_family`          → root.processor_family
 *   - Subarray row:        `cpu_skus[3]` or `cpu_skus.3` → root.cpu_skus[3]
 *   - Subarray cell:       `cpu_skus[3].tdp_w` or `cpu_skus.3.tdp_w`
 *   - Nested:              `vendor_extensions.lenovo.machine_types`
 *
 * Extraction fields are typically wrapped as `{ value, evidence }`. When
 * the path resolves to such a wrapped scalar, getField returns the wrapper
 * and unwrapValue returns just the value. setField writes to `wrapper.value`
 * and replaces `wrapper.evidence` with the supplied evidence (per skill rules).
 *
 * Security note: field_path strings ultimately come from the /api/annotations
 * route and from spotfix_runs rows. Without the guards in lib/safe-path.ts,
 * a segment like `__proto__` would let setField write to Object.prototype
 * — a process-wide prototype-pollution primitive. Every helper here routes
 * through tokenizePathSafe and treats malformed / forbidden paths as
 * benign no-ops (read helpers) or typed failure results (setField).
 */
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_SEGMENTS,
  tokenizePathSafe,
  type Tokens as SafeTokens,
} from "@/lib/safe-path";

export type Tokens = SafeTokens;

/**
 * Parse a field_path like `cpu_skus[3].tdp_w` or `a.b.0.c` into tokens.
 *
 * Throws on empty input, malformed shape, or a forbidden segment
 * (`__proto__` / `prototype` / `constructor`). Callers that need a
 * non-throwing form should use `tokenizePathSafe` from `@/lib/safe-path`.
 */
export function tokenizePath(fieldPath: string): Tokens {
  const result = tokenizePathSafe(fieldPath);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.tokens;
}

/** Walk to the parent of the final path segment. Returns null if the parent doesn't exist. */
export function getParent(root: any, tokens: Tokens): { parent: any; key: string | number } | null {
  if (tokens.length === 0) return null;
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const k = tokens[i];
    if (cur == null) return null;
    // Belt-and-suspenders: tokenizePath already rejects forbidden segments,
    // but if a caller bypasses tokenizePath and constructs tokens directly
    // we still refuse to descend into prototype-shaped keys.
    if (typeof k === "string" && FORBIDDEN_SEGMENTS.has(k)) return null;
    cur = (cur as any)[k as any];
  }
  if (cur == null) return null;
  const finalKey = tokens[tokens.length - 1];
  if (typeof finalKey === "string" && FORBIDDEN_SEGMENTS.has(finalKey)) return null;
  return { parent: cur, key: finalKey };
}

/** Returns the raw value at the path (the wrapper if wrapped); undefined if unresolved or unsafe. */
export function getField(root: any, fieldPath: string): any {
  const tokenized = tokenizePathSafe(fieldPath);
  if (!tokenized.ok) return undefined;
  const parent = getParent(root, tokenized.tokens);
  if (!parent) return undefined;
  return (parent.parent as any)[parent.key as any];
}

/** Returns the underlying scalar value, unwrapping `{ value, evidence }` if present. */
export function unwrapValue(field: any): any {
  if (field && typeof field === "object" && !Array.isArray(field) && "value" in field) {
    return field.value;
  }
  return field;
}

/**
 * Returns true if a field at this path resolves in the extraction object.
 * Unsafe or malformed paths resolve to false (they don't throw).
 *
 * Uses `Object.hasOwn` rather than `in` so the check cannot accidentally
 * walk into the prototype chain even on a path that escaped tokenizePathSafe.
 */
export function pathResolves(root: any, fieldPath: string): boolean {
  const tokenized = tokenizePathSafe(fieldPath);
  if (!tokenized.ok) return false;
  let cur: any = root;
  for (const k of tokenized.tokens) {
    if (cur == null) return false;
    if (typeof cur !== "object") return false;
    if (typeof k === "number") {
      if (!Array.isArray(cur) || k < 0 || k >= cur.length) return false;
    } else if (!Object.prototype.hasOwnProperty.call(cur, k)) {
      return false;
    }
    cur = cur[k as any];
  }
  return true;
}

/**
 * Set a field at the given dotted path. If the existing value is a wrapped
 * `{ value, evidence }` scalar, only `wrapper.value` is replaced (and `evidence`
 * is replaced if `newEvidence` is supplied; `spot_fix` is attached if supplied).
 * If the existing value is a bare scalar/object, it's replaced wholesale.
 *
 * Returns `{ ok: true, before }` on success, `{ ok: false, reason }` on failure.
 */
export function setField(
  root: any,
  fieldPath: string,
  newValue: any,
  options: { evidence?: any; spotFix?: any } = {}
): { ok: true; before: any } | { ok: false; reason: string } {
  const tokenized = tokenizePathSafe(fieldPath);
  if (!tokenized.ok) return { ok: false, reason: tokenized.reason };
  const parent = getParent(root, tokenized.tokens);
  if (!parent) return { ok: false, reason: "parent path does not resolve" };
  const key = parent.key;
  // getParent already rejects forbidden final keys, but check once more
  // before the write — this is the single line that would otherwise be the
  // prototype-pollution sink.
  if (typeof key === "string" && FORBIDDEN_SEGMENTS.has(key)) {
    return { ok: false, reason: `forbidden final segment: ${key}` };
  }
  const cur = (parent.parent as any)[key as any];
  const before = cur === undefined ? null : JSON.parse(JSON.stringify(cur));

  // Wrapped scalar — preserve shape, mutate `.value` and `.evidence`.
  if (
    cur &&
    typeof cur === "object" &&
    !Array.isArray(cur) &&
    "value" in cur
  ) {
    cur.value = newValue;
    if (options.evidence !== undefined) cur.evidence = options.evidence;
    if (options.spotFix !== undefined) cur.spot_fix = options.spotFix;
    return { ok: true, before };
  }

  // Wrapped row inside an array — same logic if the cur has `.value`.
  // Otherwise the whole subtree is replaced. Spot-fix on a whole row is rare;
  // skill says "flag on a row means something in this row is wrong", but the
  // agent typically targets a sub-cell. Replace wholesale here.
  //
  // Use defineProperty rather than `[key] = ...` so even an unguarded key
  // (which shouldn't reach here) cannot replace a prototype slot — an own,
  // writable, enumerable data property always shadows any prototype key.
  Object.defineProperty(parent.parent, key as PropertyKey, {
    value: newValue,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return { ok: true, before };
}

/** Atomic write: write to a sibling tmp file, then rename over the target. */
export function atomicWriteJson(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/** Append a row to extraction_metadata.spot_fix_log[] (creating the array if missing). */
export function appendSpotFixLog(extraction: any, entry: any): void {
  if (!extraction.extraction_metadata || typeof extraction.extraction_metadata !== "object") {
    extraction.extraction_metadata = {};
  }
  if (!Array.isArray(extraction.extraction_metadata.spot_fix_log)) {
    extraction.extraction_metadata.spot_fix_log = [];
  }
  extraction.extraction_metadata.spot_fix_log.push(entry);
}

/**
 * Best-effort "current evidence.source" lookup for the field at a path.
 * Returns the manifest `local:` path string used in the existing evidence
 * record, if any. Used to scope source reads on spot-fix.
 */
export function currentEvidenceSource(root: any, fieldPath: string): string | null {
  const field = getField(root, fieldPath);
  if (!field || typeof field !== "object") return null;
  const ev = (field as any).evidence;
  if (!ev || typeof ev !== "object") return null;
  const src = ev.source;
  if (typeof src !== "string" || src.length === 0) return null;
  if (src === "source-silent" || src === "derived") return null;
  return src;
}

/** Used by callers to display before/after JSON snippets. */
export function jsonSnippet(value: any): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

