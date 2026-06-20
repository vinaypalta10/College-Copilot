/**
 * propose-meeting-slots skill — STUB.
 *
 * Used by ReplyAgent when reply-classifier returns yes/maybe.
 *
 * Suggested implementation:
 *   - Take recipient timezone + your free windows.
 *   - Output a short, warm reply with 2-3 concrete slots.
 *   - Stay in the relationship-first tone.
 *
 * To activate: implement run() and flip status to "active".
 */

import { registerSkill, SkillNotImplementedError, type Skill } from "./registry.ts";

export interface ProposeMeetingSlotsInput {
  targetName: string;
  recipientTimezone?: string;
  myTimezone?: string;
  freeWindows?: { start: string; end: string }[];
  replyContext?: string;
}

export interface ProposeMeetingSlotsOutput {
  draft: string;
  proposedSlots: { start: string; end: string }[];
}

export const proposeMeetingSlots: Skill<ProposeMeetingSlotsInput, ProposeMeetingSlotsOutput> = {
  name: "propose-meeting-slots",
  description: "Draft a short scheduling reply with 2-3 concrete slots when a recipient says yes/maybe.",
  status: "stub",
  run: async () => {
    throw new SkillNotImplementedError("propose-meeting-slots", "implement in src/skills/propose-meeting-slots.ts");
  },
};

registerSkill(proposeMeetingSlots);
