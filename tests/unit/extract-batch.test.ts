import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.PRODUCT_MCP_DATA_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.PRODUCT_MCP_DATA_DIR;
  else process.env.PRODUCT_MCP_DATA_DIR = originalDataDir;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
});

describe("batchCustomId + resolveBatchProductDir", () => {
  it("round-trips nested product paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-batch-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();

    const { batchCustomId, resolveBatchProductDir } = await import(
      "@/lib/pipeline/extract"
    );

    const productPathRel = "server/dell/poweredge/r770";
    const ctx = {
      slug: "r770",
      productPathRel,
      productDir: path.join(root, productPathRel),
      productMdPath: "",
      frontmatter: {},
      manifest: [],
      categoryKey: "server",
    };

    expect(batchCustomId(ctx)).toBe(productPathRel);
    expect(resolveBatchProductDir(productPathRel)).toBe(
      path.resolve(root, productPathRel)
    );
  });

  it("does not resolve bare slug to a top-level directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-batch-"));
    tempDirs.push(root);
    const nested = path.join(root, "server/dell/poweredge/r770");
    fs.mkdirSync(nested, { recursive: true });
    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();

    const { resolveBatchProductDir } = await import("@/lib/pipeline/extract");

    expect(resolveBatchProductDir("server/dell/poweredge/r770")).toBe(
      path.resolve(nested)
    );
    expect(resolveBatchProductDir("r770")).toBe(path.resolve(root, "r770"));
    expect(resolveBatchProductDir("r770")).not.toBe(path.resolve(nested));
  });

  it("rejects custom_id values that escape the data root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-batch-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();

    const { resolveBatchProductDir } = await import("@/lib/pipeline/extract");

    expect(() => resolveBatchProductDir("../../../etc/passwd")).toThrow(
      /escapes PRODUCT_MCP_DATA_DIR/
    );
  });
});

describe("writeExtractionJson", () => {
  it("invalidates the extraction cache after writing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-batch-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    vi.resetModules();

    const extractions = await import("@/lib/extractions");
    const spy = vi.spyOn(extractions, "invalidateExtractionCache");
    const { writeExtractionJson } = await import("@/lib/pipeline/extract");

    const productDir = path.join(root, "server/dell/poweredge/r770");
    fs.mkdirSync(productDir, { recursive: true });

    writeExtractionJson(productDir, { slug: "r770", vendor: "dell" });

    expect(spy).toHaveBeenCalledOnce();
  });
});
