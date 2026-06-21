/**
 * research-summarizer — explains what was found and what to inspect next, and
 * adds a short per-opportunity fit note.
 *
 * Uses the LLM when an ANTHROPIC_API_KEY is present (it only sees a compact
 * digest, never raw pages); otherwise falls back to a transparent heuristic and
 * says so. It never fabricates opportunities — it only describes the records it
 * was given.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { getProvider } from "../../../providers/index.ts";
import { log } from "../../../lib/log.ts";
import type { ResearchOpportunity } from "../types.ts";

export interface SummarizerInput {
  opportunities: ResearchOpportunity[];
  query?: string;
  interests?: string[];
}
export interface SummarizerOutput {
  opportunities: ResearchOpportunity[];
  summary: string;
  mode: "llm" | "heuristic";
}

function heuristicFit(opp: ResearchOpportunity, terms: string[]): string {
  const hay = `${opp.title} ${opp.topics.join(" ")} ${opp.evidence}`.toLowerCase();
  const matched = terms.filter((t) => hay.includes(t));
  if (matched.length) return `Mentions ${matched.slice(0, 3).join(", ")}; verify undergrad eligibility on the page.`;
  if (opp.topics.length) return `Topic overlap: ${opp.topics.slice(0, 3).join(", ")}.`;
  return "Surfaced from a research index — open the page to confirm relevance.";
}

const SYSTEM = `You help an undergraduate triage research opportunities. You are given a compact JSON list of opportunities (title, org, type, topics, evidence snippet). For EACH item, write one short fit sentence (<=22 words) explaining why it might suit the student and what to verify. Return ONLY a JSON array of strings, same order, same length. Be honest; if evidence is thin, say to open the page.`;

async function llmFit(input: SummarizerInput): Promise<string[] | null> {
  const provider = getProvider();
  if (!provider.available() || input.opportunities.length === 0) return null;
  const digest = input.opportunities.map((o, i) => ({
    i, title: o.title.slice(0, 80), org: o.organization, type: o.opportunityType,
    topics: o.topics, evidence: o.evidence.slice(0, 160),
  }));
  const user = `Student query: ${input.query || "(none)"}\nInterests: ${(input.interests ?? []).join(", ") || "(none)"}\nOpportunities: ${JSON.stringify(digest)}`;
  try {
    const res = await provider.chat({
      system: [{ text: SYSTEM, cache: true }],
      userMessage: user,
      maxTokens: 600,
      temperature: 0,
      model: provider.defaultScorerModel,
    });
    const match = res.text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const arr = JSON.parse(match[0]) as unknown;
    if (Array.isArray(arr) && arr.length === input.opportunities.length && arr.every((x) => typeof x === "string")) {
      return arr as string[];
    }
    return null;
  } catch (e) {
    log.warn("research-summarizer LLM fit failed, using heuristic", { error: (e as Error).message });
    return null;
  }
}

export async function summarize(input: SummarizerInput): Promise<SummarizerOutput> {
  const terms = [...(input.query ?? "").toLowerCase().split(/[^a-z0-9+#]+/), ...(input.interests ?? []).map((s) => s.toLowerCase())].filter((t) => t.length > 2);
  const llm = await llmFit(input);
  const opportunities = input.opportunities.map((o, i) => ({
    ...o,
    fit: llm?.[i] ?? heuristicFit(o, terms),
  }));

  const types = new Map<string, number>();
  for (const o of opportunities) types.set(o.opportunityType, (types.get(o.opportunityType) ?? 0) + 1);
  const breakdown = [...types.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
  const next = opportunities.find((o) => !o.deadline)?.title;

  const summary = opportunities.length
    ? `Found ${opportunities.length} opportunity(ies) (${breakdown}). Next: open ${next ? `"${next.slice(0, 60)}"` : "the top results"} to confirm undergrad eligibility and deadlines.`
    : "No opportunities matched — try broader interests or a different query.";

  return { opportunities, summary, mode: llm ? "llm" : "heuristic" };
}

export const researchSummarizer: Agent<SummarizerInput, SummarizerOutput> = {
  name: "research-summarizer",
  description: "Explains what was found, suggests what to inspect next, and adds an honest per-opportunity fit note (LLM when available, else heuristic).",
  status: "active",
  skills: [],
  run: (input) => summarize(input),
};

registerAgent(researchSummarizer);
