/**
 * LLM provider abstraction.
 *
 * Every call site (scorer, critic, writer, advisor) goes through this interface.
 * The concrete implementation lives in src/providers/anthropic.ts (Claude API).
 *
 * Why a thin wrapper instead of using the SDK directly: it keeps every call site
 * provider-agnostic and centralizes prompt-caching. The `cache: true` flag on a
 * SystemBlock maps to Anthropic's cache_control hint.
 */

export interface SystemBlock {
  text: string;
  /** Hint that this block is stable across calls and should be cached if the provider supports it. */
  cache?: boolean;
}

export interface ChatRequest {
  model?: string;
  system: string | SystemBlock[];
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: ChatUsage;
  cacheHit: boolean;
}

export interface Provider {
  readonly name: "anthropic";
  readonly defaultWriterModel: string;
  readonly defaultScorerModel: string;
  readonly defaultCriticModel: string;
  /** True iff the provider has an API key available — caller falls back to local heuristics otherwise. */
  available(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
