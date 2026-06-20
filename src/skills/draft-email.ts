/**
 * draft-email skill — atomic tool.
 *
 * Pure draft generation: takes a target + optional draft to improve +
 * optional preference examples, produces one draft.
 *
 * Used by the OutreachAgent (which composes this with `critique-draft`).
 * Provider chosen by LLM_PROVIDER env var.
 */

import { localDraft } from "../writer/local.ts";
import { SYSTEM_PROMPT, STYLE_GUIDE_BLOCK } from "../writer/prompts.ts";
import { registerSkill, type Skill } from "./registry.ts";
import { getProvider } from "../providers/index.ts";
import type { RatingRow, TargetRow } from "../db/repo.ts";

export interface DraftEmailInput {
  target: TargetRow;
  currentDraft?: string;
  preferences?: { positive: RatingRow[]; negative: RatingRow[] };
  extraConstraints?: string[];
}

export interface DraftEmailOutput {
  draft: string;
  mode: "llm" | "local";
  provider?: string;
  model?: string;
  cacheHit?: boolean;
  note?: string;
}

function preferenceBlock(positive: RatingRow[], negative: RatingRow[]): string {
  if (!positive.length && !negative.length) return "";
  const fmt = (r: RatingRow, marker: string) =>
    `[${marker} rating=${r.rating}${r.critique ? ` critique="${r.critique.replace(/"/g, "'")}"` : ""}]\n${r.draft.trim()}`;
  return [
    "Preference examples accumulated from past human ratings (treat as soft RL signal — emulate the cadence of the positives, avoid the patterns in the negatives):",
    ...positive.map(r => fmt(r, "✓ POSITIVE")),
    ...negative.map(r => fmt(r, "✗ NEGATIVE")),
  ].join("\n\n");
}

async function draftEmailRun(input: DraftEmailInput): Promise<DraftEmailOutput> {
  const provider = getProvider();
  if (!provider.available()) {
    return {
      draft: localDraft(input.target),
      mode: "local",
      provider: provider.name,
      note: `No API key set for provider "${provider.name}" — local relationship-first writer used.`,
    };
  }

  const targetBlock = JSON.stringify({
    name: input.target.name,
    lab: input.target.lab,
    project: input.target.project,
    path: input.target.path,
    fit: input.target.fit,
    sentence: input.target.sentence,
    evidence: input.target.evidence,
    source: input.target.source,
  }, null, 2);

  const preferences = input.preferences
    ? preferenceBlock(input.preferences.positive, input.preferences.negative)
    : "";

  const userMessage = [
    `Target:\n${targetBlock}`,
    preferences || null,
    input.extraConstraints?.length
      ? `Additional constraints from the critic:\n${input.extraConstraints.map(s => `- ${s}`).join("\n")}`
      : null,
    input.currentDraft
      ? `Current draft to improve (keep the warm-student tone):\n${input.currentDraft}`
      : null,
  ].filter(Boolean).join("\n\n");

  const response = await provider.chat({
    model: provider.defaultWriterModel,
    maxTokens: 700,
    system: [
      { text: SYSTEM_PROMPT },
      { text: STYLE_GUIDE_BLOCK, cache: true },
    ],
    userMessage,
  });

  if (!response.text) throw new Error(`Empty draft from ${provider.name}`);
  return {
    draft: response.text,
    mode: "llm",
    provider: provider.name,
    model: response.model,
    cacheHit: response.cacheHit,
  };
}

export const draftEmail: Skill<DraftEmailInput, DraftEmailOutput> = {
  name: "draft-email",
  description: "Generate one cold-email draft for a target. Optionally consumes thumbs-up/down preference examples and critic constraints.",
  status: "active",
  run: draftEmailRun,
};

registerSkill(draftEmail);
