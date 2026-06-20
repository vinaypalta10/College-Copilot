/**
 * orchestrator — see orchestrator.md for the full design doc.
 *
 * Active (MVP). Implements the `process-new-target` pipeline only:
 *   1. information-extractor → refresh evidence from the source URL
 *   2. persist new evidence + score on the target row
 *   3. social-agent → produce a draft conditioned on the refreshed evidence
 *   4. persist the draft on the target's decision
 *
 * `process-reply` and `trigger-followup` remain unimplemented — wire them
 * once you have real replies / follow-ups to design around.
 */

import { registerAgent, runAgent } from "./registry.ts";
import type { Agent } from "./types.ts";
import { log } from "../lib/log.ts";
import type { InformationExtractorInput, InformationExtractorOutput } from "./information-extractor.ts";
import type { SocialAgentInput, SocialAgentOutput } from "./social-agent.ts";

export type OrchestratorTask =
  | "process-new-target"
  | "process-reply"
  | "trigger-followup";

export interface OrchestratorInput {
  task: OrchestratorTask;
  context: {
    targetId?: string;
    replyBody?: string;
    daysSinceSent?: number;
  };
}

export interface OrchestratorStep {
  agent: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface OrchestratorOutput {
  plan: Array<{ agent: string; input: unknown }>;
  results: OrchestratorStep[];
}

const SKILLS: readonly string[] = [];
const DELEGATES = ["information-extractor", "social-agent"] as const;

async function processNewTarget(targetId: string, ctx: { repo: import("../db/repo.ts").Repo; targetId?: string }): Promise<OrchestratorOutput> {
  const { repo } = ctx;
  const target = repo.getTarget(targetId);
  if (!target) {
    return {
      plan: [],
      results: [{ agent: "orchestrator", ok: false, error: `target not found: ${targetId}` }],
    };
  }
  if (!target.source) {
    return {
      plan: [],
      results: [{ agent: "orchestrator", ok: false, error: `target ${targetId} has no source URL to extract from` }],
    };
  }

  const plan: OrchestratorOutput["plan"] = [
    { agent: "information-extractor", input: { source: target.source } },
    { agent: "social-agent", input: { targetId } },
  ];
  const results: OrchestratorStep[] = [];

  // Step 1: extract
  let extracted: InformationExtractorOutput | null = null;
  try {
    extracted = await runAgent<InformationExtractorInput, InformationExtractorOutput>(
      "information-extractor",
      { source: target.source },
      { repo, targetId },
    );
    results.push({ agent: "information-extractor", ok: true, output: extracted });
  } catch (error) {
    const message = (error as Error).message;
    log.warn("orchestrator: information-extractor failed", { error: message });
    results.push({ agent: "information-extractor", ok: false, error: message });
    // Continue anyway — the social-agent can still draft from the existing target data.
  }

  // Step 2: persist enriched fields onto the target row (if extraction succeeded)
  if (extracted) {
    const facetsJson = extracted.facets.length ? JSON.stringify(extracted.facets) : target.score_facets;
    const isPlaceholder = (s: string | null) => !s || s === "(extracting…)" || s === "(extracting...)";
    const upgradedName = isPlaceholder(target.name) && extracted.title ? extracted.title : target.name;
    const upgradedProject = isPlaceholder(target.project) && extracted.title ? extracted.title : target.project;
    const upgradedFit = isPlaceholder(target.fit) && extracted.summary
      ? extracted.summary.slice(0, 220)
      : target.fit;
    repo.upsertTarget({
      ...target,
      name: upgradedName,
      project: upgradedProject,
      fit: upgradedFit,
      evidence: extracted.evidence || target.evidence,
      score: Math.max(target.score, extracted.score),
      score_facets: facetsJson,
      contact: target.contact || extracted.detectedEmail,
      last_seen_at: new Date().toISOString(),
    });
  }

  // Step 3: draft via social-agent, using the freshly-persisted target row
  const refreshedTarget = repo.getTarget(targetId) ?? target;
  try {
    const drafted = await runAgent<SocialAgentInput, SocialAgentOutput>(
      "social-agent",
      { target: refreshedTarget },
      { repo, targetId },
    );
    results.push({ agent: "social-agent", ok: true, output: drafted });

    // Step 4: persist the draft on the target's decision
    if (drafted.draft) {
      const existing = repo.getDecision(targetId);
      repo.upsertDecision({
        target_id: targetId,
        status: existing?.status ?? "pending",
        checks: existing?.checks ?? null,
        decided_at: existing?.decided_at ?? null,
        draft: drafted.draft,
        recipient: existing?.recipient ?? refreshedTarget.contact ?? null,
      });
    }
  } catch (error) {
    const message = (error as Error).message;
    log.warn("orchestrator: social-agent failed", { error: message });
    results.push({ agent: "social-agent", ok: false, error: message });
  }

  return { plan, results };
}

async function orchestratorRun(input: OrchestratorInput, ctx: { repo: import("../db/repo.ts").Repo; targetId?: string }): Promise<OrchestratorOutput> {
  switch (input.task) {
    case "process-new-target": {
      const targetId = input.context.targetId;
      if (!targetId) {
        return {
          plan: [],
          results: [{ agent: "orchestrator", ok: false, error: "process-new-target requires context.targetId" }],
        };
      }
      return processNewTarget(targetId, ctx);
    }
    case "process-reply":
    case "trigger-followup":
      return {
        plan: [],
        results: [{
          agent: "orchestrator",
          ok: false,
          error: `Task "${input.task}" is not yet implemented. See src/agents/orchestrator.md for the design.`,
        }],
      };
    default:
      return {
        plan: [],
        results: [{ agent: "orchestrator", ok: false, error: `Unknown task: ${(input as { task: string }).task}` }],
      };
  }
}

export const orchestrator: Agent<OrchestratorInput, OrchestratorOutput> = {
  name: "orchestrator",
  description: "Top-level controller. Implements `process-new-target` (extract → persist → draft → persist); `process-reply` and `trigger-followup` are still placeholders.",
  status: "active",
  skills: SKILLS,
  delegatesTo: DELEGATES,
  run: orchestratorRun,
};

registerAgent(orchestrator);
