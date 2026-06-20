/**
 * compose-followup skill — STUB.
 *
 * Used by FollowUpAgent when a target has been "sent" without a reply for
 * N days.
 *
 * Suggested implementation:
 *   - Pull the original draft and any rating critique from the repo.
 *   - Avoid repeating the same opening — change the cadence.
 *   - One sentence on "wanted to surface this back up", then either a new
 *     question or a small update.
 *
 * To activate: implement run() and flip status to "active".
 */

import { registerSkill, SkillNotImplementedError, type Skill } from "./registry.ts";
import type { TargetRow } from "../db/repo.ts";

export interface ComposeFollowupInput {
  target: TargetRow;
  originalDraft: string;
  daysSinceSent: number;
  newAngle?: "different-question" | "new-artifact" | "softer-ask";
}

export interface ComposeFollowupOutput {
  draft: string;
  angle: string;
}

export const composeFollowup: Skill<ComposeFollowupInput, ComposeFollowupOutput> = {
  name: "compose-followup",
  description: "Draft a short follow-up email referencing the original ask with a new angle.",
  status: "stub",
  run: async () => {
    throw new SkillNotImplementedError("compose-followup", "implement in src/skills/compose-followup.ts");
  },
};

registerSkill(composeFollowup);
