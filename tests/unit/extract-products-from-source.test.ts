import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitProductsFromSource } from "@/lib/pipeline/extract-products-from-source";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

function writeCategorySidecar(filename: string): string {
  const rel = `server/dell/source/${filename}`;
  const abs = path.resolve("./data/sample", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "# test sidecar\n", "utf8");
  cleanupPaths.push(path.dirname(abs));
  return rel;
}

describe("commitProductsFromSource path safety", () => {
  it("rejects sourcePath values outside PRODUCT_MCP_DATA_DIR", async () => {
    await expect(
      commitProductsFromSource(
        "../../README.md",
        ["evil"],
        [
          {
            slug: "evil",
            model_number: "Evil",
            marketing_name: "Traversal Proof",
            confidence: 1,
          },
        ],
        { category: "server", vendor: "dell", productLine: "poweredge" }
      )
    ).rejects.toThrow(/path escapes PRODUCT_MCP_DATA_DIR/);
  });

  it("rejects traversal in override metadata before writing product skeletons", async () => {
    const sourcePath = writeCategorySidecar("commit-traversal-test.md");

    await expect(
      commitProductsFromSource(
        sourcePath,
        ["evil"],
        [
          {
            slug: "evil",
            model_number: "Evil",
            marketing_name: "Traversal Proof",
            confidence: 1,
          },
        ],
        {
          category: "../../../../../../../tmp/pde-owned-test",
          vendor: "attacker",
          productLine: "line",
        }
      )
    ).rejects.toThrow(/category must be a safe path segment/);

    expect(fs.existsSync("/tmp/pde-owned-test")).toBe(false);
  });

  it("rejects selected slugs that are not safe path segments", async () => {
    const sourcePath = writeCategorySidecar("commit-slug-test.md");

    await expect(
      commitProductsFromSource(
        sourcePath,
        ["../evil"],
        [
          {
            slug: "../evil",
            model_number: "Evil",
            marketing_name: "Traversal Proof",
            confidence: 1,
          },
        ],
        { category: "server", vendor: "dell", productLine: "poweredge" }
      )
    ).rejects.toThrow(/slug must be a safe path segment/);
  });
});
