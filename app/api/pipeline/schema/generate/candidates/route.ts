import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const KNOWN_CATEGORIES = [
  "server",
  "storage",
  "hci",
  "networking",
  "chassis",
  "software-defined-infrastructure",
];

interface Candidate {
  path: string; // relative to PRODUCT_MCP_DATA_DIR
  bytes: number;
  category: string;
}

/**
 * Lightweight enumerator of every Reducto-parsed sidecar (`.md` under any
 * `source/` dir in scope). Powers the wizard's reference picker.
 */
export async function GET() {
  const dataDir = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const candidates: Candidate[] = [];

  function walk(dir: string, category: string, depth: number) {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        if (e.name === "source") {
          // Enumerate .md sidecars at this level only.
          let files: fs.Dirent[];
          try {
            files = fs.readdirSync(full, { withFileTypes: true });
          } catch {
            continue;
          }
          for (const f of files) {
            if (!f.isFile()) continue;
            if (!f.name.toLowerCase().endsWith(".md")) continue;
            const filePath = path.join(full, f.name);
            try {
              const stat = fs.statSync(filePath);
              candidates.push({
                path: path.relative(dataDir, filePath),
                bytes: stat.size,
                category,
              });
            } catch {
              // skip
            }
          }
          continue;
        }
        walk(full, category, depth + 1);
      }
    }
  }

  for (const c of KNOWN_CATEGORIES) {
    const cdir = path.join(dataDir, c);
    if (fs.existsSync(cdir)) walk(cdir, c, 0);
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));

  // Bundle the _base.md content for the side-by-side preview.
  let baseSchema = "";
  try {
    baseSchema = fs.readFileSync(path.join(dataDir, "schemas", "_base.md"), "utf8");
  } catch {
    // optional
  }

  return NextResponse.json({ candidates, baseSchema });
}
