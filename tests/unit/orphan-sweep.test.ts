import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteOrphans, listOrphans } from "@/lib/pipeline/orphan-sweep";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
});

function makeProduct(slug: string): {
  productDir: string;
  sourceDir: string;
  sourcesYaml: string;
} {
  const lineDir = path.resolve("./data/sample/server/testvendor/orphanline");
  const productDir = path.join(lineDir, slug);
  const sourceDir = path.join(productDir, "source");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(productDir, `${slug}.md`), `---\n---\n# ${slug}\n`, "utf8");
  cleanupPaths.push(lineDir);
  return {
    productDir,
    sourceDir,
    sourcesYaml: path.join(productDir, "sources.yaml"),
  };
}

describe("orphan sweep safety", () => {
  it("does not classify source files as orphans when sources.yaml is missing", () => {
    const slug = `orphan-missing-${Date.now()}`;
    const { sourceDir } = makeProduct(slug);
    const proof = path.join(sourceDir, "manual.pdf");
    fs.writeFileSync(proof, "manual source");

    const report = listOrphans(slug);

    expect(report.manifestMissing).toBe(true);
    expect(report.orphans).toEqual([]);
    expect(fs.existsSync(proof)).toBe(true);
  });

  it("refuses to delete files when sources.yaml is missing", () => {
    const slug = `orphan-refuse-${Date.now()}`;
    const { sourceDir } = makeProduct(slug);
    const proof = path.join(sourceDir, "manual.pdf");
    fs.writeFileSync(proof, "manual source");

    const result = deleteOrphans(slug, { dryRun: false, confirmDelete: true });

    expect(result.manifestMissing).toBe(true);
    expect(result.deleted).toEqual([]);
    expect(result.refusedReason).toMatch(/sources\.yaml is missing/);
    expect(fs.existsSync(proof)).toBe(true);
  });

  it("dry-runs by default even with a valid manifest", () => {
    const slug = `orphan-dry-run-${Date.now()}`;
    const { sourceDir, sourcesYaml } = makeProduct(slug);
    const orphan = path.join(sourceDir, "orphan.pdf");
    fs.writeFileSync(orphan, "orphan source");
    fs.writeFileSync(sourcesYaml, "sources: []\n", "utf8");

    const result = deleteOrphans(slug);

    expect(result.dryRun).toBe(true);
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(orphan)).toBe(true);
  });

  it("requires explicit confirmation before deleting valid-manifest orphans", () => {
    const slug = `orphan-confirm-${Date.now()}`;
    const { sourceDir, sourcesYaml } = makeProduct(slug);
    const orphan = path.join(sourceDir, "orphan.pdf");
    fs.writeFileSync(orphan, "orphan source");
    fs.writeFileSync(sourcesYaml, "sources: []\n", "utf8");

    const refused = deleteOrphans(slug, { dryRun: false });
    expect(refused.requiresConfirmation).toBe(true);
    expect(refused.deleted).toEqual([]);
    expect(fs.existsSync(orphan)).toBe(true);

    const confirmed = deleteOrphans(slug, {
      dryRun: false,
      confirmDelete: true,
    });
    expect(confirmed.deleted).toEqual(["orphan.pdf"]);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it("preserves files listed in sources.yaml and deletes only confirmed orphans", () => {
    const slug = `orphan-preserve-${Date.now()}`;
    const { sourceDir, sourcesYaml } = makeProduct(slug);
    const kept = path.join(sourceDir, "kept.pdf");
    const orphan = path.join(sourceDir, "orphan.pdf");
    fs.writeFileSync(kept, "kept source");
    fs.writeFileSync(orphan, "orphan source");
    fs.writeFileSync(
      sourcesYaml,
      "sources:\n  - filename: kept.pdf\n    type: spec-sheet\n",
      "utf8"
    );

    const result = deleteOrphans(slug, {
      dryRun: false,
      confirmDelete: true,
    });

    expect(result.deleted).toEqual(["orphan.pdf"]);
    expect(fs.existsSync(kept)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
  });
});
