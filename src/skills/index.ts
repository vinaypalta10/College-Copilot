/**
 * Skill registry entry point.
 *
 * Skills are atomic tools that agents call during a single run. Importing this
 * file side-effect-registers every skill below.
 */

import "./professor-rating.ts";

export { listSkills, getSkill, runSkill, registerSkill, SkillNotImplementedError } from "./registry.ts";
export type { Skill, SkillContext, SkillStatus } from "./registry.ts";
