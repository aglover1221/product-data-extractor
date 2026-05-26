/**
 * Safe field-path parsing for object-graph access into extraction.json.
 *
 * extraction.json field paths follow the spot-fix-extraction skill convention:
 *   - dotted:    a.b.c
 *   - bracket:   a[3].b
 *   - mixed:     a.3.b
 *   - nested:    vendor_extensions.lenovo.machine_types
 *
 * Field paths flow in from /api/annotations and from spotfix_runs rows into
 * lib/pipeline/extraction-paths.ts:setField, which walks the object graph
 * and writes at the final segment. Without the guards in this module the
 * write can land on Object.prototype (segments `__proto__` / `prototype` /
 * `constructor`) — a process-wide prototype-pollution primitive.
 *
 * Two layers of defense, used by both the API boundary and the path helpers:
 *
 *   1. FORBIDDEN_SEGMENTS — explicit deny-list of segments that map onto
 *      Object.prototype's surface. Any path containing one is rejected.
 *   2. FIELD_PATH_RE — positive shape regex. Even if a future Node release
 *      adds a new prototype-shaped key, paths that don't match the strict
 *      identifier / array-index grammar are still rejected.
 *
 * The two layers compose; either alone is insufficient.
 */

/**
 * Property names that map onto Object.prototype's surface and must never be
 * used as field-path segments. Reads and writes through these segments are
 * both rejected.
 */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

/**
 * Strict shape for a field_path:
 *   - first segment: identifier `[A-Za-z_][A-Za-z0-9_-]*`
 *   - subsequent:    `.identifier` | `[digits]` | `.digits`
 *
 * Hyphens are allowed inside identifiers because some schemas use them
 * (e.g. `dimm-slots`). Digits-only segments index into arrays.
 */
export const FIELD_PATH_RE: RegExp =
  /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\]|\.\d+)*$/;

export type Tokens = (string | number)[];

export type TokenizeResult =
  | { ok: true; tokens: Tokens }
  | { ok: false; reason: string };

/**
 * Tokenize a field_path safely. Returns `{ ok: false, reason }` for empty
 * input, malformed shape, or any forbidden segment. Never throws.
 *
 * The forbidden-segment check fires on EVERY segment, not just the final
 * one — so a path like `a.__proto__.b` is rejected even though the actual
 * pollution write would only land if `__proto__` were the parent of the
 * final segment. Defense in depth: also blocks read-side leaks via
 * getField / pathResolves.
 */
export function tokenizePathSafe(fieldPath: unknown): TokenizeResult {
  if (typeof fieldPath !== "string" || fieldPath.length === 0) {
    return { ok: false, reason: "field_path must be a non-empty string" };
  }
  if (!FIELD_PATH_RE.test(fieldPath)) {
    return { ok: false, reason: `malformed field_path: ${fieldPath}` };
  }
  const out: Tokens = [];
  const normalized = fieldPath.replace(/\[(\d+)\]/g, ".$1");
  for (const seg of normalized.split(".")) {
    if (seg === "") continue;
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      return {
        ok: false,
        reason: `forbidden path segment: ${seg}`,
      };
    }
    if (/^\d+$/.test(seg)) out.push(Number(seg));
    else out.push(seg);
  }
  if (out.length === 0) {
    return { ok: false, reason: "no usable segments" };
  }
  return { ok: true, tokens: out };
}

/**
 * Boolean shortcut for the API boundary — true iff the field_path passes
 * the deny-list AND the shape regex. Equivalent to
 * `tokenizePathSafe(fieldPath).ok`.
 */
export function isFieldPathSafe(fieldPath: unknown): boolean {
  return tokenizePathSafe(fieldPath).ok;
}
