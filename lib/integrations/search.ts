/**
 * LLM-driven web search wrapper.
 *
 * Used by the discover + sources phases. The Anthropic Messages API exposes
 * web_search as a server-side tool: the model emits tool_use blocks, the
 * server executes the search and returns tool_result blocks back to the model
 * in the same response, and the model continues. We don't manually fan tool
 * results back — the loop is server-side. We just inspect the FINAL assistant
 * content for the structured JSON the prompt asks for.
 *
 * If the tool name / version Anthropic exposes drifts, tweak WEB_SEARCH_TOOL.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { messagesCreate } from "@/lib/integrations/anthropic";
import { env } from "@/lib/env";

/**
 * Anthropic web_search tool definition. Exact name is versioned; bump when
 * Anthropic ships a new version. Per the Wave 6 brief, code defensively here
 * — runtime errors surface clearly because the tool name is the only knob.
 */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20250305" as const,
  name: "web_search" as const,
  // max_uses caps how many search calls the model can make in one turn.
  // 10 is generous for portfolio-discovery; tighten if cost is an issue.
  max_uses: 10,
};

export interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
}

export interface SearchToolOptions {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  /** Override the tool definition entirely (e.g. to bump max_uses). */
  tool?: typeof WEB_SEARCH_TOOL;
}

export interface SearchToolResult {
  /** Concatenated text content from the final assistant turn. */
  text: string;
  /** Raw web-search hits the orchestrator can persist for audit. */
  hits: SearchHit[];
  /** Stop reason — `end_turn` is the happy path. */
  stopReason: string | null;
  /** Token usage from the response. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  /** The full Anthropic message object — for debugging. */
  raw: Anthropic.Messages.Message;
}

/**
 * Run a Messages call with the web_search tool enabled. Anthropic loops the
 * tool calls server-side so a single Messages call returns the model's final
 * answer (text content) along with tool_use / tool_result blocks reflecting
 * any searches it made.
 */
export async function searchWithTool(
  prompt: string,
  options: SearchToolOptions = {}
): Promise<SearchToolResult> {
  const model = options.model ?? env.ANTHROPIC_EXTRACT_MODEL;
  const maxTokens = options.maxTokens ?? 8192;
  const tool = options.tool ?? WEB_SEARCH_TOOL;

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    tools: [tool] as unknown as Anthropic.Messages.Tool[],
    messages: [{ role: "user", content: prompt }],
  };
  if (options.systemPrompt) {
    params.system = options.systemPrompt;
  }

  const message = await messagesCreate(params);

  // Walk the response content. Final assistant text blocks carry the structured
  // output the prompt asked for. Tool_use / tool_result blocks are
  // intermediate steps and we capture their hits for audit.
  const textParts: string[] = [];
  const hits: SearchHit[] = [];

  for (const block of message.content as Anthropic.Messages.ContentBlock[]) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if ((block as any).type === "web_search_tool_result") {
      // Anthropic emits a `web_search_tool_result` block alongside `tool_use`
      // when running web_search server-side. The shape:
      //   { type, tool_use_id, content: [{ type: "web_search_result", url, title, encrypted_content, page_age? }, ...] }
      const items = (block as any).content;
      if (Array.isArray(items)) {
        for (const it of items) {
          if (it && typeof it === "object" && it.type === "web_search_result") {
            hits.push({
              url: String(it.url ?? ""),
              title: String(it.title ?? ""),
              snippet: typeof it.snippet === "string" ? it.snippet : undefined,
            });
          }
        }
      }
    }
  }

  return {
    text: textParts.join("\n").trim(),
    hits,
    stopReason: message.stop_reason ?? null,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: (message.usage as any).cache_read_input_tokens ?? 0,
      cacheCreationTokens: (message.usage as any).cache_creation_input_tokens ?? 0,
    },
    raw: message,
  };
}

/**
 * Best-effort JSON extraction from an LLM final text block. Handles three
 * common cases:
 *   1. Pure JSON (the prompt asks for this).
 *   2. JSON wrapped in ```json ... ``` fences.
 *   3. JSON embedded in a longer prose response.
 * Throws with a useful error if no parseable JSON is found.
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  // Case 1: pure JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // fall through
    }
  }
  // Case 2: fenced
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch {
      // fall through
    }
  }
  // Case 3: first {...} or [...] balanced block
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  const startIdx =
    objStart === -1
      ? arrStart
      : arrStart === -1
        ? objStart
        : Math.min(objStart, arrStart);
  if (startIdx >= 0) {
    const candidate = balancedSlice(trimmed.slice(startIdx));
    if (candidate) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // fall through
      }
    }
  }
  throw new Error(
    `extractJson: no parseable JSON found in LLM output (first 200 chars: ${trimmed.slice(0, 200)})`
  );
}

/** Returns the first balanced {...} or [...] substring starting at index 0. */
function balancedSlice(s: string): string | null {
  if (!s) return null;
  const open = s[0];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

/**
 * Legacy helper retained for other callers — same name as the original Wave 1
 * stub. Returns hits for an arbitrary natural-language query. Backed by
 * web_search via a single Messages call.
 */
export async function webSearch(query: string): Promise<SearchHit[]> {
  const { hits } = await searchWithTool(
    `Search the web for: ${query}\n\nReturn only a JSON array of objects with keys "url", "title", "snippet" — one entry per result. Do not include prose.`,
    { maxTokens: 2048 }
  );
  return hits;
}
