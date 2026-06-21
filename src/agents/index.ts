/** Side-effect entry point for the currently active course-planner agents. */
import "./course-planner/index.ts";
import "./opportunity-orchestrator.ts";
import "./industry-jobs/index.ts";

export { listAgents, getAgent, runAgent, registerAgent } from "./registry.ts";
export type { Agent, AgentContext, AgentStatus } from "./types.ts";
