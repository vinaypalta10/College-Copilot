/**
 * plan-explainer specialist — the only LLM call in the planning pipeline.
 *
 * It receives ONLY the compressed context from context-compressor (never the
 * raw catalog) and explains, in plain language, why the proposed plan fits the
 * student's request. Falls back to a deterministic synthesis when no API key is
 * present, and says which mode it used.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { getProvider } from "../../../providers/index.ts";
import { log } from "../../../lib/log.ts";
import type { CompressedContext } from "./context-compressor.ts";

export interface PlanExplainInput {
  query: string;
  context: CompressedContext;
}
export interface PlanExplainOutput {
  explanation: string;
  mode: "llm" | "heuristic";
}

const SYSTEM = `You are a UC Berkeley academic advisor. You are given a COMPACT JSON planning context (constraints, a few ranked courses with scores/reasons, a proposed schedule, requirement coverage, and workload). Explain to the student, in 3-5 sentences, why this plan fits their request. Reference specific course codes. Be honest about trade-offs (heavy workload, uncovered requirements). Do NOT invent courses or facts not present in the context.`;

function heuristic(input: PlanExplainInput): string {
  const c = input.context;
  const parts: string[] = [];
  if (c.schedule.courses.length) {
    parts.push(`I drafted a ${c.schedule.totalUnits}-unit plan: ${c.schedule.courses.join(", ")}.`);
  } else if (c.candidates.length) {
    parts.push(`Top matches: ${c.candidates.slice(0, 3).map((x) => x.code).join(", ")}.`);
  }
  const top = c.candidates[0];
  if (top) parts.push(`${top.code} leads on fit (${top.score}/100) — ${top.topReason}.`);
  if (c.coverage.length) parts.push(`These cover ${c.coverage.length} of your remaining requirement(s).`);
  if (c.uncovered.length) parts.push(`Still open: ${c.uncovered.join(", ")}.`);
  if (c.workload) parts.push(c.workload.summary);
  return parts.join(" ") || "No courses matched your constraints — try widening them.";
}

export async function explainPlan(input: PlanExplainInput): Promise<PlanExplainOutput> {
  const provider = getProvider();
  if (!provider.available() || input.context.candidates.length === 0) {
    return { explanation: heuristic(input), mode: "heuristic" };
  }
  try {
    const res = await provider.chat({
      system: [{ text: SYSTEM, cache: true }],
      userMessage: `Student request: ${input.query}\n\nPlanning context:\n${JSON.stringify(input.context)}`,
      maxTokens: 350,
      temperature: 0.3,
      model: provider.defaultWriterModel,
    });
    const text = res.text.trim();
    return text ? { explanation: text, mode: "llm" } : { explanation: heuristic(input), mode: "heuristic" };
  } catch (e) {
    log.warn("plan-explainer LLM failed, using heuristic", { error: (e as Error).message });
    return { explanation: heuristic(input), mode: "heuristic" };
  }
}

export const planExplainer: Agent<PlanExplainInput, PlanExplainOutput> = {
  name: "plan-explainer",
  description: "Explains why the proposed course plan fits, using ONLY the compressed planning context (the single LLM call in the pipeline).",
  status: "active",
  skills: [],
  run: (input) => explainPlan(input),
};

registerAgent(planExplainer);
