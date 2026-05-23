import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  productMdAbs,
  resolveDataRootPath,
  writeProductMdSkeleton,
} from "@/lib/pipeline/product-md-skel";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

describe("product MD skeleton path safety", () => {
  it("rejects traversal in category before computing a destination", () => {
    expect(() =>
      productMdAbs({
        category: "../../../../../../../tmp/pde-owned",
        vendor: "attacker",
        line: "line",
        slug: "evil",
      })
    ).toThrow(/category must be a safe path segment/);
  });

  it("rejects traversal in vendor, line, and slug segments", () => {
    expect(() =>
      productMdAbs({
        category: "server",
        vendor: "../attacker",
        line: "line",
        slug: "evil",
      })
    ).toThrow(/vendor must be a safe path segment/);

    expect(() =>
      productMdAbs({
        category: "server",
        vendor: "attacker",
        line: "..",
        slug: "evil",
      })
    ).toThrow(/line must be a safe path segment/);

    expect(() =>
      productMdAbs({
        category: "server",
        vendor: "attacker",
        line: "line",
        slug: "../evil",
      })
    ).toThrow(/slug must be a safe path segment/);
  });

  it("rejects relative paths that escape PRODUCT_MCP_DATA_DIR", () => {
    expect(() => resolveDataRootPath("../../README.md")).toThrow(
      /path escapes PRODUCT_MCP_DATA_DIR/
    );
  });

  it("writes normal product skeletons inside PRODUCT_MCP_DATA_DIR", () => {
    const slug = `safe-${Date.now()}`;
    const productRoot = path.resolve(
      process.env.PRODUCT_MCP_DATA_DIR ?? "./data/sample",
      "server",
      "testvendor",
      "testline",
      slug
    );
    cleanupPaths.push(path.dirname(productRoot));

    const result = writeProductMdSkeleton({
      category: "server",
      vendor: "testvendor",
      line: "testline",
      slug,
      model: "Safe Test Product",
    });

    expect(result.created).toBe(true);
    expect(result.absPath).toBe(path.join(productRoot, `${slug}.md`));
    expect(fs.existsSync(result.absPath)).toBe(true);
    expect(result.absPath.startsWith(path.resolve("./data/sample"))).toBe(true);
  });

  it("does not create an escaped file when given traversal input", () => {
    const escapeRoot = path.join(os.tmpdir(), "pde-owned-test");
    cleanupPaths.push(escapeRoot);
    fs.rmSync(escapeRoot, { recursive: true, force: true });

    expect(() =>
      writeProductMdSkeleton({
        category: "../../../../../../../tmp/pde-owned-test",
        vendor: "attacker",
        line: "line",
        slug: "evil",
        model: "Traversal Proof",
      })
    ).toThrow(/category must be a safe path segment/);

    expect(fs.existsSync(escapeRoot)).toBe(false);
  });
});
