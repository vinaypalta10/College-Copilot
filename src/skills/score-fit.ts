/**
 * score-fit skill — atomic tool.
 *
 * Wraps the keyword + LLM scorer behind the skill interface so an agent
 * can call it the same way it calls any other skill.
 */

import { registerSkill, type Skill } from "./registry.ts";
import { scoreWithClaude, type ClaudeScore } from "../scorer/claude.ts";

export interface ScoreFitInput {
  title: string;
  text: string;
}

export type ScoreFitOutput = ClaudeScore;

export const scoreFit: Skill<ScoreFitInput, ScoreFitOutput> = {
  name: "score-fit",
  description: "Score how well a page matches Ruoxi's profile facets. Combines keyword scoring with an LLM facet classifier; falls back to keyword-only without an API key.",
  status: "active",
  run: async (input) => scoreWithClaude(input.text, input.title),
};

registerSkill(scoreFit);
