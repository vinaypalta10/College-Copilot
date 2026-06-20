/**
 * Scorer — runs after the extractor finds a candidate page and decides
 * how well it matches Ruoxi's profile facets.
 *
 * Goes through the provider abstraction in src/providers/ (Claude API).
 * Falls back to keyword scoring when no ANTHROPIC_API_KEY is configured.
 */

import { profile } from "../profile/ruoxi.ts";
import { keywordScore } from "./keyword.ts";
import { log } from "../lib/log.ts";
import { getProvider } from "../providers/index.ts";

export interface ClaudeScore {
  score: number;
  facets: { id: string; label: string; hits: number }[];
  reasoning: string;
  mode: "llm" | "keyword";
  provider?: string;
}

const SYSTEM_PROMPT = `You score how well an opportunity matches Ruoxi's background and interests.

Return ONLY JSON with this shape:
{"facetHits": ["facet-id", ...], "reasoning": "one sentence"}

Use facet ids from Ruoxi's profile. Be strict — only include a facet when there is clear evidence in the opportunity text.`;

const PROFILE_BLOCK = JSON.stringify(
  {
    name: profile.name,
    school: profile.school,
    major: profile.major,
    facets: profile.facets.map(f => ({ id: f.id, label: f.label, description: f.description })),
    proof: profile.proof,
  },
  null,
  2,
);

export async function scoreWithClaude(text: string, title: string): Promise<ClaudeScore> {
  const fallback = keywordScore(text);
  const provider = getProvider();
  if (!provider.available()) {
    return { ...fallback, reasoning: `Keyword fallback (no API key for ${provider.name}).`, mode: "keyword" };
  }

  try {
    const response = await provider.chat({
      model: provider.defaultScorerModel,
      maxTokens: 400,
      system: [
        { text: SYSTEM_PROMPT },
        { text: `Ruoxi profile:\n${PROFILE_BLOCK}`, cache: true },
      ],
      userMessage: `Title: ${title}\n\nText (excerpt):\n${text.slice(0, 4000)}`,
    });

    const json = response.text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("No JSON in scorer response");
    const parsed = JSON.parse(json) as { facetHits?: string[]; reasoning?: string };
    const facetSet = new Set(parsed.facetHits ?? []);
    const facets = profile.facets
      .filter(f => facetSet.has(f.id))
      .map(f => ({ id: f.id, label: f.label, hits: 1 }));
    return {
      score: facets.length,
      facets,
      reasoning: parsed.reasoning ?? "",
      mode: "llm",
      provider: provider.name,
    };
  } catch (error) {
    log.warn("scorer llm failed, falling back to keyword", { provider: provider.name, error: (error as Error).message });
    return { ...fallback, reasoning: `${provider.name} scoring failed: ${(error as Error).message}`, mode: "keyword" };
  }
}
