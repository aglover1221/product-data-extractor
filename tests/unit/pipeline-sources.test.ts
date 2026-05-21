import path from "node:path";
import { describe, expect, it } from "vitest";
import { relForMd, sourceDirForScope, type ProductContext } from "@/lib/pipeline/sources";

function productContext(root: string): ProductContext {
  return {
    vendor: "dell",
    product_line: "poweredge",
    category: "server",
    slug: "r770",
    canonical_name: "Dell PowerEdge R770",
    product_dir: path.join(root, "server", "dell", "poweredge", "r770"),
    product_md: path.join(root, "server", "dell", "poweredge", "r770", "r770.md"),
  };
}

describe("scoped source paths", () => {
  it("stores own-scope files in the product source directory", () => {
    const root = path.resolve(process.env.PRODUCT_MCP_DATA_DIR ?? "./data/sample");
    const ctx = productContext(root);

    expect(sourceDirForScope(ctx, "own")).toBe(
      path.join(root, "server", "dell", "poweredge", "r770", "source"),
    );
    expect(relForMd("own", "spec-sheet.pdf")).toBe("source/spec-sheet.pdf");
  });

  it("stores line-scope files where ../source manifest paths resolve", () => {
    const root = path.resolve(process.env.PRODUCT_MCP_DATA_DIR ?? "./data/sample");
    const ctx = productContext(root);
    const filename = "technical-guide.pdf";

    expect(sourceDirForScope(ctx, "line")).toBe(
      path.join(root, "server", "dell", "poweredge", "source"),
    );
    expect(path.resolve(ctx.product_dir, relForMd("line", filename))).toBe(
      path.join(root, "server", "dell", "poweredge", "source", filename),
    );
  });

  it("stores category-scope files where ../../source manifest paths resolve", () => {
    const root = path.resolve(process.env.PRODUCT_MCP_DATA_DIR ?? "./data/sample");
    const ctx = productContext(root);
    const filename = "portfolio.pdf";

    expect(sourceDirForScope(ctx, "category")).toBe(
      path.join(root, "server", "dell", "source"),
    );
    expect(path.resolve(ctx.product_dir, relForMd("category", filename))).toBe(
      path.join(root, "server", "dell", "source", filename),
    );
  });
});
