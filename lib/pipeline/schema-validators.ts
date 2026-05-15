/**
 * Schema MD validators.
 *
 * Three checks run before a save lands:
 *   1. Frontmatter parses (YAML + required keys present)
 *   2. Cross-refs resolve (overlay names referenced in prose / fences exist)
 *   3. Enum / required-format sanity (no obvious typos like `req:yes` vs `Required: yes`)
 *
 * Each returns { ok, errors[] }. Errors are user-facing strings rendered in
 * the editor save panel; aggregate them to a single multi-row reject when
 * any of the three trips.
 */
import { parseMarkdown } from "@/lib/safe-matter";
import { knownSchemaNames } from "@/lib/pipeline/schemas-fs";

export type ValidationResult = { ok: boolean; errors: string[] };

const REQUIRED_FRONTMATTER_KEYS = ["name", "type"];

/** YAML parses and required keys exist. */
export function validateFrontmatter(md: string): ValidationResult {
  const errors: string[] = [];
  let parsed: ReturnType<typeof parseMarkdown>;
  try {
    parsed = parseMarkdown(md);
  } catch (e: any) {
    return { ok: false, errors: [`Frontmatter YAML failed to parse: ${e?.message ?? e}`] };
  }
  const fm = parsed.data;
  if (!fm || typeof fm !== "object") {
    return { ok: false, errors: ["Frontmatter block is missing or empty (expected leading `---` block)"] };
  }
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (fm[key] == null || String(fm[key]).trim() === "") {
      errors.push(`Frontmatter missing required key: \`${key}\``);
    }
  }
  if (fm.type && !["schema", "overlay"].includes(String(fm.type))) {
    errors.push(`Frontmatter \`type\` must be "schema" or "overlay" (got "${fm.type}")`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Cross-ref resolution: every overlay name mentioned in the body must exist
 * as a schema file (base or overlay) on disk. We pull names from a few
 * common patterns:
 *   - `overlays/{name}.md` markdown links / inline references
 *   - `schemas/overlays/{name}.md`
 *   - `compose with `{name}.md`` patterns
 *   - `parent: {name}` in frontmatter for overlays
 */
export function validateCrossRefs(md: string): ValidationResult {
  const errors: string[] = [];
  const known = knownSchemaNames();
  const referenced = new Set<string>();

  // 1. (schemas/)?overlays/{name}.md
  const overlayLinkRe = /(?:^|[^\w-])(?:schemas\/)?overlays\/([a-z0-9][a-z0-9-]+)\.md/gi;
  // 2. bare {name}.md in fences/links — too noisy to use without scope; restrict to "schemas/{name}.md"
  const baseLinkRe = /(?:^|[^\w-])schemas\/([a-z0-9][a-z0-9-]+)\.md/gi;

  for (const m of md.matchAll(overlayLinkRe)) referenced.add(m[1]);
  for (const m of md.matchAll(baseLinkRe)) {
    // Skip overlays/ matches already captured (they also match "schemas/overlays/x.md" through baseLinkRe with "overlays" as the name)
    if (m[1] === "overlays") continue;
    referenced.add(m[1]);
  }

  // 3. parent: <name> in frontmatter
  try {
    const { data: fm } = parseMarkdown(md);
    if (fm.parent) {
      const parent = String(fm.parent).replace(/\.md$/i, "").replace(/^.*\//, "").trim();
      if (parent) referenced.add(parent);
    }
  } catch {
    // frontmatter validator catches this
  }

  // Self-references are fine; "_base" is a known sentinel
  for (const ref of referenced) {
    if (ref === "_base") continue;
    if (!known.has(ref)) {
      errors.push(`Cross-ref to unknown schema/overlay: \`${ref}\` (referenced but no \`schemas/${ref}.md\` or \`schemas/overlays/${ref}.md\` on disk)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Enum / required-format sanity. Catches obvious typos in field tables
 * without re-implementing a full schema parser. Rules:
 *   - A row labeled "Required:" / "required:" outside a Markdown table is a smell;
 *     real schemas put Required as a column.
 *   - Values like "Required: y" / "required: yes/no/maybe" must be one of:
 *     yes, no, optional, recommended, "yes when ...".
 *   - Rejects shorthand like "req:" / "req=" / "Req: yes".
 */
export function validateEnums(md: string): ValidationResult {
  const errors: string[] = [];
  const ALLOWED_REQUIRED = new Set([
    "yes",
    "no",
    "optional",
    "recommended",
  ]);
  const lines = md.split("\n");

  let inFrontmatter = false;
  let frontmatterDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      frontmatterDone = true;
      continue;
    }
    if (inFrontmatter) continue;

    // Outside frontmatter: catch shorthand `req:` / `Req:` / `required=`
    const shorthandReq = /^\s*(?:req|Req|REQ)\s*[:=]/.exec(line);
    if (shorthandReq) {
      errors.push(`Line ${i + 1}: shorthand "${shorthandReq[0].trim()}" — use full \`Required:\` or a "Required" table column`);
    }

    // Inline value check — when a line literally says "Required: <value>" outside a table
    if (!/^\s*\|/.test(line)) {
      const m = /^\s*Required\s*:\s*(.+?)\s*$/i.exec(line);
      if (m) {
        const val = m[1].toLowerCase();
        const isYesWhen = val.startsWith("yes when") || val.startsWith("yes-when");
        if (!isYesWhen && !ALLOWED_REQUIRED.has(val)) {
          errors.push(
            `Line ${i + 1}: \`Required: ${m[1]}\` — value must be one of {yes, no, optional, recommended, "yes when …"}`,
          );
        }
      }
    }
  }

  // Also flag: stray frontmatter close without open
  if (!frontmatterDone && lines[0]?.trim() !== "---") {
    // No frontmatter at all — frontmatter validator will catch the missing required keys
  }

  return { ok: errors.length === 0, errors };
}

/** Run all three; merged result. */
export function validateAll(md: string): ValidationResult {
  const fm = validateFrontmatter(md);
  const xr = validateCrossRefs(md);
  const en = validateEnums(md);
  return {
    ok: fm.ok && xr.ok && en.ok,
    errors: [...fm.errors, ...xr.errors, ...en.errors],
  };
}
