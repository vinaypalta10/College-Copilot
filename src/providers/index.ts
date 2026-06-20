/**
 * Provider factory.
 *
 * College Copilot uses the Claude API (Anthropic) for writer/scorer/critic and
 * the course-advisor's NL parsing. The factory is kept as a thin seam so a
 * second provider could be added later, but Anthropic is the only backend today.
 */

import { anthropicProvider } from "./anthropic.ts";
import type { Provider } from "./types.ts";
import { log } from "../lib/log.ts";

let active: Provider | null = null;

export function getProvider(): Provider {
  if (active) return active;
  active = anthropicProvider;
  if (!active.available()) {
    log.warn("ANTHROPIC_API_KEY not set — LLM calls fall back to local heuristics", { provider: active.name });
  } else {
    log.info("llm provider active", { provider: active.name });
  }
  return active;
}

/** Test-only — force a reset so the provider can be re-picked on the next call. */
export function _resetProvider(): void {
  active = null;
}

export type { Provider, ChatRequest, ChatResponse, SystemBlock } from "./types.ts";
