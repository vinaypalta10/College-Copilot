import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, Provider, SystemBlock } from "./types.ts";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function toSystemBlocks(system: string | SystemBlock[]): Anthropic.TextBlockParam[] {
  if (typeof system === "string") return [{ type: "text", text: system }];
  return system.map(block => ({
    type: "text" as const,
    text: block.text,
    ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

export const anthropicProvider: Provider = {
  name: "anthropic",
  defaultWriterModel: process.env.ANTHROPIC_WRITER_MODEL || "claude-sonnet-4-6",
  defaultScorerModel: process.env.ANTHROPIC_SCORER_MODEL || "claude-haiku-4-5-20251001",
  defaultCriticModel: process.env.ANTHROPIC_CRITIC_MODEL || "claude-haiku-4-5-20251001",
  available: () => !!process.env.ANTHROPIC_API_KEY,
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const anthropic = getClient();
    if (!anthropic) throw new Error("ANTHROPIC_API_KEY not set");
    const model = req.model || anthropicProvider.defaultWriterModel;
    const response = await anthropic.messages.create({
      model,
      max_tokens: req.maxTokens ?? 700,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      system: toSystemBlocks(req.system),
      messages: [{ role: "user", content: req.userMessage }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    const usage = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    } | undefined;
    const cachedInputTokens = usage?.cache_read_input_tokens ?? 0;
    return {
      text,
      model,
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cachedInputTokens,
      },
      cacheHit: cachedInputTokens > 0,
    };
  },
};
