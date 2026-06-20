/**
 * Reply classifier skill — STUB.
 *
 * Purpose: when a recipient responds to one of your outreach emails, classify
 * the reply so the UI can decide what to do next (move to "replied", trigger
 * a meeting-scheduler skill, mark "no-thanks", etc).
 *
 * Suggested implementation:
 *   - Use Claude Haiku with a small structured-output prompt.
 *   - Cache the system prompt with cache_control: ephemeral.
 *   - Return one of: "yes" | "no" | "maybe" | "more-info" | "spam" | "unclear".
 *
 * Inputs come from your inbox (you'll either paste the reply or, if you wire
 * up Gmail OAuth later, pull it from the API).
 *
 * To activate:
 *   1. Implement run() below.
 *   2. Change status from "stub" to "active".
 *   3. Wire a UI action that posts a reply body to /api/skills/reply-classifier/run.
 */

import { registerSkill, SkillNotImplementedError, type Skill } from "./registry.ts";

export interface ReplyInput {
  replyBody: string;
  originalDraft?: string;
}

export interface ReplyOutput {
  classification: "yes" | "no" | "maybe" | "more-info" | "spam" | "unclear";
  rationale: string;
  suggestedNextSkill?: "meeting-scheduler" | "follow-up-composer";
}

export const replyClassifier: Skill<ReplyInput, ReplyOutput> = {
  name: "reply-classifier",
  description: "Classify an inbound reply as yes/no/maybe/more-info/spam, and recommend the next skill to invoke.",
  status: "stub",
  run: async () => {
    // TODO(you): call Claude / your model of choice with a small structured-output
    // prompt and return the classification.
    throw new SkillNotImplementedError("reply-classifier", "implement in src/skills/reply-classifier.ts");
  },
};

registerSkill(replyClassifier);
