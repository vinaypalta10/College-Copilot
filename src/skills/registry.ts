/**
 * Skill registry — minimal multi-agent scaffold.
 *
 * Each skill is a small, typed unit of behavior that can be invoked from
 * the API, from another skill (composition), or from the writer's RL loop.
 *
 * Each skill declares:
 *   - name:        stable identifier used in routes and logs
 *   - description: human-readable summary, shown in the UI Skills panel
 *   - status:      "active" (real implementation) or "stub" (TODO for you)
 *   - run(input):  the implementation
 *
 * To wire a new skill:
 *   1. Create a file under src/skills/ that exports a Skill<I, O>.
 *   2. Re-export it from src/skills/index.ts so it joins the registry.
 *   3. Use it via runSkill("skill-name", input, repo).
 *
 * SkillNotImplementedError lets you ship stub skills that compile and
 * show up in the UI before they have real logic.
 */

import type { Repo } from "../db/repo.ts";
import { log } from "../lib/log.ts";

export type SkillStatus = "active" | "stub";

export interface SkillContext {
  repo: Repo;
  targetId?: string;
}

export interface Skill<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly status: SkillStatus;
  run(input: I, ctx: SkillContext): Promise<O>;
}

export class SkillNotImplementedError extends Error {
  constructor(skillName: string, hint?: string) {
    super(`Skill "${skillName}" is a stub. Fill in src/skills/${skillName}.ts${hint ? ` — ${hint}` : ""}.`);
    this.name = "SkillNotImplementedError";
  }
}

const registry = new Map<string, Skill>();

export function registerSkill<I, O>(skill: Skill<I, O>): void {
  if (registry.has(skill.name)) {
    log.warn("skill already registered, overwriting", { skill: skill.name });
  }
  registry.set(skill.name, skill as Skill);
}

export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): { name: string; description: string; status: SkillStatus }[] {
  return [...registry.values()].map(s => ({
    name: s.name,
    description: s.description,
    status: s.status,
  }));
}

export async function runSkill<I = unknown, O = unknown>(name: string, input: I, ctx: SkillContext): Promise<O> {
  const skill = registry.get(name) as Skill<I, O> | undefined;
  if (!skill) throw new Error(`Unknown skill: ${name}`);
  const started = performance.now();
  try {
    const output = await skill.run(input, ctx);
    const duration = Math.round(performance.now() - started);
    ctx.repo.logSkillRun({
      skill: skill.name,
      target_id: ctx.targetId ?? null,
      status: "ok",
      input,
      output,
      error: null,
      duration_ms: duration,
    });
    return output;
  } catch (error) {
    const duration = Math.round(performance.now() - started);
    const isStub = error instanceof SkillNotImplementedError;
    ctx.repo.logSkillRun({
      skill: skill.name,
      target_id: ctx.targetId ?? null,
      status: isStub ? "stub" : "error",
      input,
      output: null,
      error: (error as Error).message,
      duration_ms: duration,
    });
    throw error;
  }
}
