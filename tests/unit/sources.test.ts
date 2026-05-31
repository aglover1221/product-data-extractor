import { describe, it, expect } from "vitest";
import { classifyScope, collectDeclaredSourceTypes, formatBytes } from "@/lib/sources";

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

describe("collectDeclaredSourceTypes", () => {
  it("prefers md manifest types when available", () => {
    const result = collectDeclaredSourceTypes({
      mdManifest: [
        { scope: "product", local: "source/a.pdf", type: "spec-sheet" },
        { scope: "line", local: "../source/b.pdf", type: "tech-guide" },
      ],
      manifest: {
        sources: [{ filename: "x.pdf", type: "other" }],
      },
      sourceFiles: [{ name: "spec-sheet.pdf", size: 1, isText: false }],
    });
    expect(Array.from(result).sort()).toEqual(["spec-sheet", "tech-guide"]);
  });

  it("falls back to sources.yaml manifest when md manifest is absent", () => {
    const result = collectDeclaredSourceTypes({
      mdManifest: null,
      manifest: {
        sources: [
          { filename: "a.pdf", type: "spec-sheet" },
          { filename: "b.pdf", type: "tech-guide" },
        ],
      },
      sourceFiles: [{ name: "quickspecs.pdf", size: 1, isText: false }],
    });
    expect(Array.from(result).sort()).toEqual(["spec-sheet", "tech-guide"]);
  });

  it("falls back to filename inference when no manifest data exists", () => {
    const result = collectDeclaredSourceTypes({
      mdManifest: null,
      manifest: null,
      sourceFiles: [
        { name: "technical-guide.pdf", size: 1, isText: false },
        { name: "quickspecs.pdf", size: 1, isText: false },
        { name: "notes.txt", size: 1, isText: true },
      ],
    });
    expect(Array.from(result).sort()).toEqual(["spec-sheet", "tech-guide"]);
  });
});
