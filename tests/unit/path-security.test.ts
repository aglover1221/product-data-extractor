import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideRoot } from "@/lib/path-security";

describe("isPathInsideRoot", () => {
  it("accepts the root itself and real descendants", () => {
    const root = path.resolve("/tmp/product-data");
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, "server/dell/r770.pdf"))).toBe(true);
  });

  it("rejects parent and sibling paths", () => {
    const root = path.resolve("/tmp/product-data");
    expect(isPathInsideRoot(root, path.dirname(root))).toBe(false);
    expect(isPathInsideRoot(root, `${root}-escape/leak.pdf`)).toBe(false);
  });

  it("does not reject in-root names that merely start with dots", () => {
    const root = path.resolve("/tmp/product-data");
    expect(isPathInsideRoot(root, path.join(root, "..not-parent/file.pdf"))).toBe(true);
  });
});

