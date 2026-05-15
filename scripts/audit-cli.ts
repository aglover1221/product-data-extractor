#!/usr/bin/env tsx
/**
 * audit-cli — pure-code portfolio audit, CLI entry point.
 *
 * Usage:
 *   npm run audit
 *   npm run audit -- --category server
 *   npm run audit -- --json > audit.json
 *
 * Exits non-zero when any sub-audit reports `fail` results, so this can wire
 * into CI later.
 */
import { auditPortfolio } from "@/lib/pipeline/audit";

interface CliArgs {
  category?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--category" || a === "-c") {
      out.category = argv[++i];
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npm run audit [-- --category <name>] [-- --json]\n" +
          "  --category <name>  Limit to one category (server, storage, hci, networking, chassis, software-defined-infrastructure)\n" +
          "  --json             Emit the full report as JSON to stdout"
      );
      process.exit(0);
    }
  }
  return out;
}

const COLOR = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await auditPortfolio(
    args.category ? { category: args.category } : undefined
  );

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.totals.fail > 0 ? 1 : 0);
  }

  console.log(
    COLOR.bold(
      `Portfolio audit · scope=${args.category ?? "all"} · ${report.durationMs}ms`
    )
  );
  console.log(
    `  ${COLOR.green(String(report.totals.pass))} pass / ` +
      `${COLOR.amber(String(report.totals.warn))} warn / ` +
      `${COLOR.red(String(report.totals.fail))} fail`
  );
  console.log("");

  for (const sa of report.subAudits) {
    console.log(
      COLOR.bold(sa.checkName) +
        COLOR.dim(`  (${sa.pass} pass / ${sa.warn} warn / ${sa.fail} fail)`)
    );
    const issues = sa.results.filter((r) => r.status !== "pass");
    if (issues.length === 0) {
      console.log(COLOR.dim("  no issues"));
      console.log("");
      continue;
    }
    for (const r of issues) {
      const badge =
        r.status === "fail" ? COLOR.red("FAIL") : COLOR.amber("WARN");
      console.log(`  ${badge} ${r.subject}`);
      console.log(`    ${r.message}`);
      if (r.fixHint) console.log(COLOR.dim(`    fix: ${r.fixHint}`));
    }
    console.log("");
  }

  if (report.categories.length > 0) {
    console.log(COLOR.bold("Per-category totals"));
    for (const cat of report.categories) {
      const c = (report as any).byCategory[cat] ?? {
        pass: 0,
        fail: 0,
        warn: 0,
      };
      console.log(
        `  ${cat.padEnd(34)} ` +
          `${COLOR.green(String(c.pass).padStart(4))} pass / ` +
          `${COLOR.amber(String(c.warn).padStart(3))} warn / ` +
          `${COLOR.red(String(c.fail).padStart(3))} fail`
      );
    }
    console.log("");
  }

  process.exit(report.totals.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(2);
});
