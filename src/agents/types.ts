/**
 * Agent abstraction — orchestrators that USE skills.
 *
 * The relationship between agents and skills:
 *
 *   Agent (orchestrator)
 *    └─ run(input, ctx)
 *         ├─ runSkill("score-fit", …)
 *         ├─ runSkill("draft-email", …)
 *         ├─ runSkill("critique-draft", …)
 *         └─ (loop / branch as needed)
 *
 * Skills are pure tools — atomic, reusable, stateless. Agents declare which
 * skills they use (the `skills: string[]` field), so the UI can show exactly
 * what each agent calls on every run. That way "skills" mean what you
 * actually meant: the tools an agent uses each time it runs.
 */

import type { Repo } from "../db/repo.ts";

export type AgentStatus = "active" | "stub";

export interface AgentContext {
  repo: Repo;
  targetId?: string;
}

export interface Agent<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly status: AgentStatus;
  /** Names of skills this agent invokes on every run. */
  readonly skills: readonly string[];
  /** Names of sub-agents this agent delegates to (optional; used by the orchestrator). */
  readonly delegatesTo?: readonly string[];
  run(input: I, ctx: AgentContext): Promise<O>;
}
