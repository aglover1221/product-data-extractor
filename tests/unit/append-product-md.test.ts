import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProductMdSource } from "@/lib/pipeline/sources";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function validMdPath(root: string): string {
  const mdPath = path.join(root, "r770.md");
  fs.writeFileSync(
    mdPath,
    [
      "---",
      "vendor: dell",
      "category: server",
      "sources: []",
      "---",
      "",
      "# Product",
    ].join("\n")
  );
  return mdPath;
}

describe("appendProductMdSource", () => {
  it("throws when the product MD file is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-md-"));
    tempDirs.push(root);
    const mdPath = path.join(root, "missing.md");

    expect(() =>
      appendProductMdSource({
        mdPath,
        local: "source/spec-sheet.pdf",
        docType: "spec-sheet",
        title: "Spec",
        url: "https://example.com/spec.pdf",
        pageCount: 12,
      })
    ).toThrow(/Product MD not found/);
  });

  it("throws when frontmatter delimiters are missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-md-"));
    tempDirs.push(root);
    const mdPath = path.join(root, "r770.md");
    fs.writeFileSync(mdPath, "# no frontmatter here\n");

    expect(() =>
      appendProductMdSource({
        mdPath,
        local: "source/spec-sheet.pdf",
        docType: "spec-sheet",
        title: "Spec",
        url: "https://example.com/spec.pdf",
        pageCount: 12,
      })
    ).toThrow(/missing valid frontmatter block/);
  });

  it("appends a source row when frontmatter is valid", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-md-"));
    tempDirs.push(root);
    const mdPath = validMdPath(root);

    appendProductMdSource({
      mdPath,
      local: "source/spec-sheet.pdf",
      docType: "spec-sheet",
      title: "Spec Sheet",
      url: "https://example.com/spec.pdf",
      pageCount: 12,
    });

    const updated = fs.readFileSync(mdPath, "utf8");
    expect(updated).toContain("local: source/spec-sheet.pdf");
    expect(updated).toContain("type: spec-sheet");
    expect(updated).toContain("url: https://example.com/spec.pdf");
  });
});
