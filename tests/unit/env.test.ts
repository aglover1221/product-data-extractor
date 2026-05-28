import { describe, expect, it } from "vitest";
import { z } from "zod";

const trimEnvString = (value: unknown) =>
  typeof value === "string" ? value.trim() : value;

const TestEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(trimEnvString, z.string().default("")),
  PRODUCT_MCP_DATA_DIR: z.preprocess(
    trimEnvString,
    z.string().min(1).default("./data/sample"),
  ),
});

describe("env trimming", () => {
  it("strips surrounding whitespace from API keys", () => {
    const parsed = TestEnvSchema.parse({
      ANTHROPIC_API_KEY: "  sk-ant-test  \n",
    });
    expect(parsed.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it("strips whitespace from data dir paths", () => {
    const parsed = TestEnvSchema.parse({
      PRODUCT_MCP_DATA_DIR: " ./data/sample \n",
    });
    expect(parsed.PRODUCT_MCP_DATA_DIR).toBe("./data/sample");
  });
});
