/**
 * Contact finder skill — STUB.
 *
 * Purpose: given a target name + lab/company, dig beyond the source URL to
 * surface a likely email address (Berkeley directory, lab page, GitHub profile,
 * etc) when none was discovered during initial extraction.
 *
 * Suggested implementation:
 *   - Try a sequence of cheap, deterministic strategies first:
 *       1. fetch the target's primary URL, look for `mailto:`
 *       2. derive `firstname@<lab-host>` candidates and verify via fast HEAD
 *          requests to an MX-lookup service or by parsing affiliation pages
 *       3. fall back to Claude for a "look at this person's pages and propose
 *          one likely contact email" call
 *   - Always return a confidence score so the UI can hide low-confidence guesses.
 *
 * To activate:
 *   1. Implement run() below.
 *   2. Change status from "stub" to "active".
 *   3. Call it after quick-add or scan when target.contact starts with "Need".
 */

import { registerSkill, SkillNotImplementedError, type Skill } from "./registry.ts";

export interface ContactFinderInput {
  name: string;
  lab?: string | null;
  sourceUrl?: string | null;
  hints?: string[];
}

export interface ContactFinderOutput {
  email: string | null;
  confidence: number; // 0-1
  evidence: string[];
}

export const contactFinder: Skill<ContactFinderInput, ContactFinderOutput> = {
  name: "contact-finder",
  description: "Find a likely email address for a target when initial extraction missed one. Returns email + confidence + evidence trail.",
  status: "stub",
  run: async () => {
    // TODO(you): implement deterministic + LLM-assisted email discovery.
    throw new SkillNotImplementedError("contact-finder", "implement in src/skills/contact-finder.ts");
  },
};

registerSkill(contactFinder);
