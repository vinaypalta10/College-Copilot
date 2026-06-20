/**
 * critique-draft skill — atomic tool.
 *
 * Scores a draft 1-5 across four dimensions, returns structured feedback.
 * Used by the OutreachAgent (after draft-email) and by any other agent
 * that wants to evaluate a draft quality.
 *
 * Falls back to a rubric-based heuristic when no provider API key is set.
 */

import { profile } from "../profile/ruoxi.ts";
import { registerSkill, type Skill } from "./registry.ts";
import { log } from "../lib/log.ts";
import { getProvider } from "../providers/index.ts";

export interface CritiqueDraftInput {
  draft: string;
  target: {
    name: string;
    project: string | null;
    path: string;
  };
}

export interface CritiqueDraftOutput {
  score: number;
  dimensions: {
    specificity: number;
    warmth: number;
    question_quality: number;
    brevity: number;
  };
  verdict: string;
  issues: string[];
  mode: "llm" | "heuristic";
  provider?: string;
}

const SYSTEM_PROMPT = `You are an expert critic for cold-outreach emails from undergraduate students.

Rate the draft on a 1-5 scale across four dimensions:
- specificity:      is the project reference concrete and grounded, not generic?
- warmth:           does it sound human, not robotic?
- question_quality: is there one thoughtful, answerable question (not a generic ask)?
- brevity:          is it tight (no padding, ~150-220 words)?

Return ONLY JSON:
{
  "specificity": 1-5,
  "warmth": 1-5,
  "question_quality": 1-5,
  "brevity": 1-5,
  "verdict": "one short sentence",
  "issues": ["one fix", "another fix"]
}`;

function heuristicScore(draft: string): CritiqueDraftOutput {
  const lower = draft.toLowerCase();
  const words = draft.trim().split(/\s+/).length;

  const hedges = ["i am passionate", "i would love to", "amazing", "incredible", "i'd love to learn"];
  const weakAsks = ["do you have", "any opportunities", "any openings"];
  const hasSubject = /^subject:/im.test(draft);
  const hasQuestion = /\?/.test(draft);
  const tooLong = words > 260;
  const tooShort = words < 80;

  const issues: string[] = [];
  if (!hasSubject) issues.push("Missing Subject: line.");
  if (!hasQuestion) issues.push("No question — relationship-first emails should ask one specific thing.");
  if (hedges.some(h => lower.includes(h))) issues.push("Hedge phrases detected (\"passionate\", \"amazing\", etc.).");
  if (weakAsks.some(w => lower.includes(w))) issues.push("Weak ask phrasing (\"do you have...\").");
  if (tooLong) issues.push(`Too long (${words} words).`);
  if (tooShort) issues.push(`Too short (${words} words).`);

  const specificity = hasQuestion && /\b(method|paper|benchmark|trace|dataset|trajectory|failure)\b/i.test(draft) ? 4 : 2;
  const warmth = hedges.some(h => lower.includes(h)) ? 2 : 4;
  const question_quality = hasQuestion ? (weakAsks.some(w => lower.includes(w)) ? 2 : 4) : 1;
  const brevity = tooLong ? 2 : tooShort ? 3 : 4;
  const score = Math.round((specificity + warmth + question_quality + brevity) / 4);
  return {
    score,
    dimensions: { specificity, warmth, question_quality, brevity },
    verdict: issues.length ? "Heuristic flags: " + issues[0] : "Heuristic check passed.",
    issues,
    mode: "heuristic",
  };
}

function clamp(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n)));
}

async function critiqueRun(input: CritiqueDraftInput): Promise<CritiqueDraftOutput> {
  const provider = getProvider();
  if (!provider.available()) return heuristicScore(input.draft);

  try {
    const response = await provider.chat({
      model: provider.defaultCriticModel,
      maxTokens: 500,
      system: [
        { text: SYSTEM_PROMPT },
        { text: `Style notes for context:\n${profile.styleNotes.join("\n")}`, cache: true },
      ],
      userMessage: `Target: ${input.target.name} (${input.target.path}) — ${input.target.project ?? ""}\n\nDraft:\n${input.draft}`,
    });
    const json = response.text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("No JSON in critic response");
    const parsed = JSON.parse(json) as {
      specificity?: number;
      warmth?: number;
      question_quality?: number;
      brevity?: number;
      verdict?: string;
      issues?: string[];
    };
    const dims = {
      specificity: clamp(parsed.specificity ?? 3),
      warmth: clamp(parsed.warmth ?? 3),
      question_quality: clamp(parsed.question_quality ?? 3),
      brevity: clamp(parsed.brevity ?? 3),
    };
    const overall = Math.round((dims.specificity + dims.warmth + dims.question_quality + dims.brevity) / 4);
    return {
      score: overall,
      dimensions: dims,
      verdict: (parsed.verdict ?? "").slice(0, 200),
      issues: (parsed.issues ?? []).slice(0, 6),
      mode: "llm",
      provider: provider.name,
    };
  } catch (error) {
    log.warn("critique-draft llm failed", { provider: provider.name, error: (error as Error).message });
    return heuristicScore(input.draft);
  }
}

export const critiqueDraft: Skill<CritiqueDraftInput, CritiqueDraftOutput> = {
  name: "critique-draft",
  description: "Score a draft 1-5 across specificity, warmth, question quality, and brevity. Returns structured issues that another skill can act on.",
  status: "active",
  run: critiqueRun,
};

registerSkill(critiqueDraft);
