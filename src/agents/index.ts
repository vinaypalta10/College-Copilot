/**
 * Agent registry entry point.
 *
 * Three agents:
 *   - information-extractor  (stub) — extracts related work from a source
 *   - orchestrator           (stub) — top-level controller, delegates to others
 *   - social-agent           (active) — drafts cold emails with the RLHF
 *                                       preference loop (uses ratings as
 *                                       in-context exemplars)
 *
 * Each has a colocated .md design doc next to its .ts file.
 */

import "./information-extractor.ts";
import "./orchestrator.ts";
import "./social-agent.ts";
import "./course-advisor.ts";

export { listAgents, getAgent, runAgent, registerAgent } from "./registry.ts";
export type { Agent, AgentContext, AgentStatus } from "./types.ts";
