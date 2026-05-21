import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { classifyScope, formatBytes } from "@/lib/sources";

const originalDataDir = process.env.PRODUCT_MCP_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PRODUCT_MCP_DATA_DIR;
  else process.env.PRODUCT_MCP_DATA_DIR = originalDataDir;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}-escape`, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe("classifyScope (manifest local: → scope)", () => {
  it("classifies bare or source-prefixed paths as product scope", () => {
    expect(classifyScope("source/spec-sheet.pdf")).toBe("product");
    expect(classifyScope("spec-sheet.pdf")).toBe("product");
  });

  it("classifies single ../ prefix as line scope", () => {
    expect(classifyScope("../source/tech-guide.pdf")).toBe("line");
  });

  it("classifies double ../../ prefix as category scope", () => {
    expect(classifyScope("../../source/platform-intro.pdf")).toBe("category");
  });

  it("tolerates leading whitespace", () => {
    expect(classifyScope("   ../source/foo.pdf")).toBe("line");
  });
});

describe("formatBytes", () => {
  it("renders 0 specially", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("renders sub-kilobyte counts in B", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("crosses to KB at 1024", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("crosses to MB at 1024 * 1024", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("crosses to GB at 1024 ** 3 with two decimals", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatBytes(3.25 * 1024 ** 3)).toBe("3.25 GB");
  });
});

describe("resolveManifestPath", () => {
  it("rejects sibling directories with the same string prefix as the data root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-root-"));
    tempDirs.push(root);
    const productDir = path.join(root, "server", "dell", "poweredge", "r770");
    const escapeDir = `${root}-escape`;
    fs.mkdirSync(productDir, { recursive: true });
    fs.mkdirSync(escapeDir, { recursive: true });
    const leakPath = path.join(escapeDir, "leak.pdf");
    fs.writeFileSync(leakPath, "not really a pdf");

    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();
    const { resolveManifestPath } = await import("@/lib/sources");

    const manifestPath = path.relative(productDir, leakPath);
    expect(resolveManifestPath(productDir, manifestPath)).toBeNull();
  });

  it("still resolves files that are actually inside the data root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-root-"));
    tempDirs.push(root);
    const productDir = path.join(root, "server", "dell", "poweredge", "r770");
    const sourcePath = path.join(productDir, "source", "spec-sheet.pdf");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "not really a pdf");

    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();
    const { resolveManifestPath } = await import("@/lib/sources");

    expect(resolveManifestPath(productDir, "source/spec-sheet.pdf")).toBe(sourcePath);
  });
});
