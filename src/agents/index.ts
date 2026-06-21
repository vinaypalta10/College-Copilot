/**
 * Agent registry entry point.
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

import "./course-planner/index.ts";
import "./research-opportunities/index.ts";
import "./industry-jobs/index.ts";

export { listAgents, getAgent, runAgent, registerAgent } from "./registry.ts";
export type { Agent, AgentContext, AgentStatus } from "./types.ts";
