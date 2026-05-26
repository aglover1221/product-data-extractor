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
  vi.restoreAllMocks();
  vi.resetModules();
});

function seedSchema(root: string, name: string, content: string) {
  const schemaDir = path.join(root, "schemas");
  fs.mkdirSync(schemaDir, { recursive: true });
  const abs = path.join(schemaDir, `${name}.md`);
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

describe("saveSchemaVersionAtomic", () => {
  it("restores previous filesystem content when insertVersion fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-schema-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;

    const original = [
      "---",
      "schema_version: v1.0",
      "description: original",
      "---",
      "",
      "# Original",
    ].join("\n");
    const updated = [
      "---",
      "schema_version: v1.1",
      "description: updated",
      "---",
      "",
      "# Updated",
    ].join("\n");
    const abs = seedSchema(root, "server", original);

    vi.resetModules();
    const schemaVersions = await import("@/lib/pipeline/schema-versions");
    const schemaFs = await import("@/lib/pipeline/schemas-fs");

    vi.spyOn(schemaVersions, "insertVersion").mockImplementation(() => {
      throw new Error("simulated db insert failure");
    });

    const rec = schemaFs.findSchemaFile("server");
    expect(rec).not.toBeNull();

    expect(() =>
      schemaVersions.saveSchemaVersionAtomic(rec!, {
        name: "server",
        version: "v1.1",
        content_md: updated,
        status: "active",
      })
    ).toThrow(/simulated db insert failure/);

    expect(fs.readFileSync(abs, "utf8")).toBe(original);
  });

  it("writes filesystem and records version when insert succeeds", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdex-schema-"));
    tempDirs.push(root);
    process.env.PRODUCT_MCP_DATA_DIR = root;
    process.env.STUDIO_DB_PATH = path.join(root, "studio.db");

    const original = [
      "---",
      "schema_version: v1.0",
      "description: original",
      "---",
      "",
      "# Original",
    ].join("\n");
    const updated = [
      "---",
      "schema_version: v1.1",
      "description: updated",
      "---",
      "",
      "# Updated",
    ].join("\n");
    const abs = seedSchema(root, "server", original);

    vi.resetModules();
    const schemaVersions = await import("@/lib/pipeline/schema-versions");
    const schemaFs = await import("@/lib/pipeline/schemas-fs");

    const rec = schemaFs.findSchemaFile("server");
    expect(rec).not.toBeNull();

    const { version } = schemaVersions.saveSchemaVersionAtomic(rec!, {
      name: "server",
      version: "v1.1",
      content_md: updated,
      status: "active",
    });

    expect(version).toBe("v1.1");
    expect(fs.readFileSync(abs, "utf8")).toBe(updated);
    expect(schemaVersions.getVersionByVersion("server", "v1.1")?.content_md).toBe(
      updated
    );
  });
});
