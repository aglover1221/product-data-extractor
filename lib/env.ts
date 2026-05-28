import { z } from "zod";
import "dotenv/config";

/**
 * Runtime env validation. Fail loudly if a required key is missing rather
 * than crashing deep in an integration. Optional keys default to empty string
 * so feature gating is explicit at call sites (don't rely on undefined).
 *
 * `PRODUCT_MCP_DATA_DIR` defaults to `./data/sample` so a fresh clone boots
 * against the bundled sample dataset. Point it at a real knowledgebase to
 * use the studio over your own data.
 */
const trimEnvString = (value: unknown) =>
  typeof value === "string" ? value.trim() : value;

const EnvSchema = z.object({
  PRODUCT_MCP_DATA_DIR: z.preprocess(
    trimEnvString,
    z.string().min(1).default("./data/sample"),
  ),
  ANTHROPIC_API_KEY: z.preprocess(trimEnvString, z.string().default("")),
  REDUCTO_API_KEY: z.preprocess(trimEnvString, z.string().default("")),
  STUDIO_DB_PATH: z.preprocess(trimEnvString, z.string().default("./data/studio.db")),
  MAX_RUN_USD: z.coerce.number().positive().default(50),
  ANTHROPIC_EXTRACT_MODEL: z.string().default("claude-opus-4-7"),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
