import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.PRODUCT_MCP_DATA_DIR;
const tempDirs: string[] = [];

function minimalServerExtraction(model: string) {
  return {
    vendor: "dell",
    category: "server",
    product_line: "poweredge",
    slug: "r770",
    model,
  };
}

function writeExtractionAt(root: string, model: string): string {
  const fp = path.join(root, "server/dell/poweredge/r770/extraction.json");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(minimalServerExtraction(model), null, 2));
  return fp;
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PRODUCT_MCP_DATA_DIR;
  else process.env.PRODUCT_MCP_DATA_DIR = originalDataDir;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe("extraction cache invalidation", () => {
  it("writeExtractionJson refreshes getExtraction without waiting for TTL", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-cache-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    writeExtractionAt(root, "Old Model");

    vi.resetModules();
    const extractions = await import("@/lib/extractions");
    expect(extractions.getExtraction("r770")?.model).toBe("Old Model");

    const { writeExtractionJson } = await import("@/lib/pipeline/extract");
    const productDir = path.join(root, "server/dell/poweredge/r770");
    writeExtractionJson(productDir, minimalServerExtraction("New Model"));

    expect(extractions.getExtraction("r770")?.model).toBe("New Model");
  });

  it("atomicWriteJson refreshes getExtraction for extraction.json targets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-cache-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    const fp = writeExtractionAt(root, "Before Spotfix");

    vi.resetModules();
    const extractions = await import("@/lib/extractions");
    expect(extractions.getExtraction("r770")?.model).toBe("Before Spotfix");

    const { atomicWriteJson } = await import("@/lib/pipeline/extraction-paths");
    atomicWriteJson(fp, minimalServerExtraction("After Spotfix"));

    expect(extractions.getExtraction("r770")?.model).toBe("After Spotfix");
  });

  it("writeExtractionJson calls invalidateExtractionCache", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-cache-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();

    const extractions = await import("@/lib/extractions");
    const spy = vi.spyOn(extractions, "invalidateExtractionCache");
    const { writeExtractionJson } = await import("@/lib/pipeline/extract");

    const productDir = path.join(root, "server/dell/poweredge/r770");
    fs.mkdirSync(productDir, { recursive: true });
    writeExtractionJson(productDir, minimalServerExtraction("Test"));

    expect(spy).toHaveBeenCalledOnce();
  });
});
