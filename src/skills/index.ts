/**
 * Skill registry entry point.
 *
 * Skills are atomic tools that agents call during a single run. Importing
 * this file side-effect-registers every skill below. Add new skills by
 * importing them here.
 *
 * Skills should be small and reusable; if a skill ends up orchestrating
 * multiple steps, promote it to an Agent in src/agents/.
 */

// Active tools
import "./fetch-page.ts";
import "./score-fit.ts";
import "./draft-email.ts";
import "./critique-draft.ts";
import "./professor-rating.ts";

// Stubs (typed placeholders for you to fill in)
import "./reply-classifier.ts";
import "./contact-finder.ts";
import "./propose-meeting-slots.ts";
import "./compose-followup.ts";

export { listSkills, getSkill, runSkill, registerSkill, SkillNotImplementedError } from "./registry.ts";
export type { Skill, SkillContext, SkillStatus } from "./registry.ts";
