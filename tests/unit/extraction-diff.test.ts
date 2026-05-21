import { describe, it, expect } from "vitest";
import { diffExtractions } from "@/lib/pipeline/extraction-diff";
import type { Extraction } from "@/lib/extractions";

function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    vendor: "Dell",
    category: "server",
    product_line: "poweredge",
    slug: "r770",
    model: "PowerEdge R770",
    description: "test",
    overlays: [],
    extraction_metadata: { schema_version: "v1", extracted_at: "2026-05-01T00:00:00Z" },
    sources: [],
    ...overrides,
  };
}

function scalar(value: unknown, confidence = 0.9) {
  return {
    value,
    evidence: {
      source: "source/spec.md",
      anchor: "anchor",
      page: 1,
      quote: "q",
      confidence,
    },
  };
}

describe("diffExtractions — identity & summary", () => {
  it("returns zero non-unchanged when both trees are identical", () => {
    const a = makeExtraction({
      server_type: scalar("general-purpose"),
      rack_units: scalar(2),
    } as Partial<Extraction>);
    const b = makeExtraction({
      server_type: scalar("general-purpose"),
      rack_units: scalar(2),
    } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    expect(diff.summary.changed).toBe(0);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.unchanged).toBeGreaterThan(0);
  });

  it("captures top-level identity on both sides", () => {
    const a = makeExtraction({ slug: "left-thing", model: "Left" });
    const b = makeExtraction({ slug: "right-thing", model: "Right" });
    const diff = diffExtractions(a, b);
    expect(diff.identityLeft.slug).toBe("left-thing");
    expect(diff.identityRight.slug).toBe("right-thing");
    expect(diff.identityLeft.schema_version).toBe("v1");
  });

  it("excludes identity keys from field rows", () => {
    const a = makeExtraction({ server_type: scalar("a") } as Partial<Extraction>);
    const b = makeExtraction({ server_type: scalar("b") } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const paths = diff.fields.map((f) => f.path);
    expect(paths).not.toContain("vendor");
    expect(paths).not.toContain("extraction_metadata");
    expect(paths).not.toContain("slug");
  });
});

describe("diffExtractions — scalar fields", () => {
  it("flags a changed scalar with both evidence blocks preserved", () => {
    const a = makeExtraction({
      server_type: scalar("general-purpose", 0.95),
    } as Partial<Extraction>);
    const b = makeExtraction({
      server_type: scalar("ai-optimized", 0.7),
    } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "server_type");
    expect(row).toBeDefined();
    expect(row?.status).toBe("changed");
    expect(row?.kind).toBe("scalar");
    if (row?.kind === "scalar") {
      expect(row.left).toBe("general-purpose");
      expect(row.right).toBe("ai-optimized");
      expect(row.evidenceLeft?.confidence).toBe(0.95);
      expect(row.evidenceRight?.confidence).toBe(0.7);
      expect(row.confidenceDelta).toBeCloseTo(-0.25, 2);
    }
  });

  it("treats null-equal-to-null as unchanged", () => {
    const a = makeExtraction({ eol_date: scalar(null) } as Partial<Extraction>);
    const b = makeExtraction({ eol_date: scalar(null) } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "eol_date");
    expect(row?.status).toBe("unchanged");
  });

  it("flags as added when field is only present on the right", () => {
    const a = makeExtraction();
    const b = makeExtraction({ generation: scalar("17G") } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "generation");
    expect(row?.status).toBe("added");
    if (row?.kind === "scalar") {
      expect(row.right).toBe("17G");
      expect(row.left).toBeUndefined();
    }
  });

  it("flags as removed when field is only present on the left", () => {
    const a = makeExtraction({ generation: scalar("16G") } as Partial<Extraction>);
    const b = makeExtraction();
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "generation");
    expect(row?.status).toBe("removed");
    if (row?.kind === "scalar") {
      expect(row.left).toBe("16G");
      expect(row.right).toBeUndefined();
    }
  });
});

describe("diffExtractions — scalar sets", () => {
  it("detects added/removed members in a tag list", () => {
    const a = makeExtraction({
      workload_tags: scalar(["virtualization", "ai-inference"]),
    } as Partial<Extraction>);
    const b = makeExtraction({
      workload_tags: scalar(["virtualization", "database", "hyperscale"]),
    } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "workload_tags");
    expect(row?.kind).toBe("set");
    if (row?.kind === "set") {
      expect(row.added.sort()).toEqual(["database", "hyperscale"].sort());
      expect(row.removed).toEqual(["ai-inference"]);
      expect(row.status).toBe("changed");
    }
  });

  it("treats reorder of the same members as unchanged", () => {
    const a = makeExtraction({
      workload_tags: scalar(["a", "b", "c"]),
    } as Partial<Extraction>);
    const b = makeExtraction({
      workload_tags: scalar(["c", "a", "b"]),
    } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "workload_tags");
    expect(row?.status).toBe("unchanged");
  });
});

describe("diffExtractions — keyed row lists", () => {
  it("keys by slug and surfaces per-row deltas", () => {
    const a = makeExtraction({
      cpu_skus: [
        { slug: "xeon-1", value: { cores: 32 } },
        { slug: "xeon-2", value: { cores: 64 } },
      ],
    } as unknown as Partial<Extraction>);
    const b = makeExtraction({
      cpu_skus: [
        { slug: "xeon-1", value: { cores: 32 } },
        { slug: "xeon-2", value: { cores: 80 } },
        { slug: "xeon-3", value: { cores: 96 } },
      ],
    } as unknown as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "cpu_skus");
    expect(row?.kind).toBe("row");
    if (row?.kind === "row") {
      expect(row.status).toBe("changed");
      expect(row.rowKey).toBe("slug");
      const added = row.fields.find((f) => f.status === "added");
      const changed = row.fields.find((f) => f.status === "changed");
      expect(added?.path).toContain("xeon-3");
      expect(changed?.path).toContain("xeon-2");
    }
  });

  it("falls back to positional keys when no stable key field exists", () => {
    const a = makeExtraction({
      arr: [{ foo: 1 }, { foo: 2 }],
    } as unknown as Partial<Extraction>);
    const b = makeExtraction({
      arr: [{ foo: 1 }, { foo: 3 }],
    } as unknown as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "arr");
    expect(row?.kind).toBe("row");
    if (row?.kind === "row") {
      expect(row.rowKey).toBe("(positional)");
      const changed = row.fields.find((f) => f.status === "changed");
      expect(changed).toBeDefined();
    }
  });
});

describe("diffExtractions — confidence delta", () => {
  it("computes a numeric delta only when both sides supply confidence", () => {
    const a = makeExtraction({ x: scalar("v", 0.4) } as Partial<Extraction>);
    const b = makeExtraction({ x: scalar("v", 0.9) } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "x");
    if (row?.kind === "scalar") {
      expect(row.status).toBe("unchanged"); // same value, just confidence shift
      expect(row.confidenceDelta).toBeCloseTo(0.5, 2);
    }
  });

  it("returns null delta when one side has no confidence", () => {
    const a = makeExtraction({
      x: { value: "v", evidence: { source: "s" } },
    } as Partial<Extraction>);
    const b = makeExtraction({
      x: { value: "v", evidence: { source: "s", confidence: 0.9 } },
    } as Partial<Extraction>);
    const diff = diffExtractions(a, b);
    const row = diff.fields.find((f) => f.path === "x");
    if (row?.kind === "scalar") {
      expect(row.confidenceDelta).toBeNull();
    }
  });
});
