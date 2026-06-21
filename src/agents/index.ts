/**
 * Agent registry entry point — the multi-agent course-advising system.
 *
 *   advising-orchestrator (planner)
 *     ├─ course-finder        search + rank the live catalog
 *     ├─ professor-evaluator  lazily fetch RateMyProfessors + re-score
 *     ├─ requirement-checker  cross-course requirement coverage
 *     ├─ schedule-builder     conflict-free, unit-capped schedule
 *     └─ workload-estimator   whole-semester balance
 *
 * Importing this file side-effect-registers every agent. Specialists do real
 * work via deterministic tools; the orchestrator plans, delegates, and explains.
 */

import "./specialists/course-finder.ts";
import "./specialists/professor-evaluator.ts";
import "./specialists/requirement-checker.ts";
import "./specialists/schedule-builder.ts";
import "./specialists/workload-estimator.ts";
import "./advising-orchestrator.ts";
import "./opportunity-orchestrator.ts";

export { listAgents, getAgent, runAgent, registerAgent } from "./registry.ts";
export type { Agent, AgentContext, AgentStatus } from "./types.ts";
