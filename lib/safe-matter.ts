import matter from "gray-matter";

/** Convert any Date values in the parsed frontmatter back to ISO strings. */
function dateToString(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(dateToString);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = dateToString(val);
    return out;
  }
  return v;
}

/** Trivial key:value parser for when YAML fails. Top-level scalar keys only. */
function parseLineByLine(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

/** Parse a Markdown file with frontmatter, falling back to a tolerant line parser if YAML fails.
 *  Always normalizes Date values to YYYY-MM-DD strings so they can be rendered safely. */
export function parseMarkdown(raw: string): { data: Record<string, any>; content: string } {
  try {
    const parsed = matter(raw);
    return { data: dateToString(parsed.data) ?? {}, content: parsed.content };
  } catch (err) {
    // gray-matter / js-yaml choked on the frontmatter (e.g. unquoted curly braces).
    // Fall back to a manual split: lines between leading "---" markers are scanned line-by-line.
    const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
    if (!m) return { data: {}, content: raw };
    return { data: parseLineByLine(m[1]), content: m[2] };
  }
}
