import fs from "node:fs";
import path from "node:path";
import { parseMarkdown } from "./safe-matter";

export type Severity = "fail" | "warn" | "info" | "ok";

export type VerifyFinding = {
  severity: Severity;
  title: string;
  body: string;
};

export type VerifyFrontmatter = {
  product?: string;
  generated?: string;
  schema_version?: string;
  peer_cohort_n?: number;
  peer_cohort_rule?: string;
  peer_cohort?: string[];
  verdict?: string;
};

export type VerifyReport = {
  file: string;
  fm: VerifyFrontmatter;
  body: string;
  findings: VerifyFinding[];
  has_findings_section: boolean;
};

export function getVerifyReportPath(extractionPath: string): string | null {
  const dir = path.dirname(extractionPath);
  const fp = path.join(dir, "verify-report.md");
  return fs.existsSync(fp) ? fp : null;
}

function severityFromHeading(h: string): Severity | null {
  const m = /^(FAIL|WARN|INFO|OK)\b/i.exec(h);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t === "fail" || t === "warn" || t === "info" || t === "ok") return t;
  return null;
}

function parseFindings(body: string): { findings: VerifyFinding[]; has: boolean } {
  const lines = body.split("\n");
  let inFindings = false;
  const findings: VerifyFinding[] = [];
  let cur: VerifyFinding | null = null;
  let buf: string[] = [];
  let has = false;

  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n").trim();
      findings.push(cur);
    }
    cur = null;
    buf = [];
  };

  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      inFindings = /findings/i.test(h2[1]);
      if (inFindings) has = true;
      continue;
    }
    if (!inFindings) continue;

    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3) {
      flush();
      const sev = severityFromHeading(h3[1]);
      if (sev) {
        const title = h3[1].replace(/^(FAIL|WARN|INFO|OK):?\s*/i, "");
        cur = { severity: sev, title, body: "" };
      } else {
        cur = { severity: "info", title: h3[1], body: "" };
      }
      continue;
    }

    if (cur) buf.push(line);
  }
  flush();
  return { findings, has };
}

export function readVerifyReport(file: string): VerifyReport | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseMarkdown(raw);
  const fm = parsed.data as VerifyFrontmatter;
  const { findings, has } = parseFindings(parsed.content);
  return {
    file,
    fm,
    body: parsed.content,
    findings,
    has_findings_section: has
  };
}

export function readVerifyReportForExtraction(extractionPath: string): VerifyReport | null {
  const fp = getVerifyReportPath(extractionPath);
  if (!fp) return null;
  return readVerifyReport(fp);
}

/** Counts findings by severity. */
export function severityCounts(report: VerifyReport): Record<Severity, number> {
  const c: Record<Severity, number> = { fail: 0, warn: 0, info: 0, ok: 0 };
  for (const f of report.findings) c[f.severity]++;
  return c;
}
