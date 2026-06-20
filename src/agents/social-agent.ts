/**
 * social-agent — see social-agent.md for the full design doc.
 *
 * Active agent. Drafts a cold email each time it runs, conditioned on
 * accumulated thumbs-up/down preferences (RLHF at the prompt layer).
 * Calls draft-email then critique-draft; retries draft-email once if the
 * critic score is below WRITER_QUALITY_THRESHOLD.
 */

import { registerAgent } from "./registry.ts";
import type { Agent } from "./types.ts";
import { runSkill } from "../skills/registry.ts";
import { log } from "../lib/log.ts";
import { getProvider } from "../providers/index.ts";
import type { TargetRow } from "../db/repo.ts";
import type { DraftEmailInput, DraftEmailOutput } from "../skills/draft-email.ts";
import type { CritiqueDraftInput, CritiqueDraftOutput } from "../skills/critique-draft.ts";

export interface SocialAgentInput {
  target: TargetRow;
  currentDraft?: string;
}

export interface SocialAgentOutput {
  draft: string;
  mode: "llm" | "local";
  provider?: string;
  model?: string;
  cacheHit?: boolean;
  note?: string;
  critic?: CritiqueDraftOutput;
  iterations: number;
  preferenceExamples: { positive: number; negative: number };
  skillsUsed: string[];
}

const QUALITY_THRESHOLD = Number(process.env.WRITER_QUALITY_THRESHOLD ?? 4);
const MAX_ITERATIONS = Number(process.env.WRITER_MAX_ITERATIONS ?? 2);
const SKILLS = ["draft-email", "critique-draft"] as const;

async function socialRun(input: SocialAgentInput, ctx: { repo: import("../db/repo.ts").Repo; targetId?: string }): Promise<SocialAgentOutput> {
  const { repo } = ctx;
  const { positive, negative } = repo.preferenceExamples(3);
  const preferenceMeta = { positive: positive.length, negative: negative.length };
  const provider = getProvider();
  const skillsUsed: string[] = [];

  let extraConstraints: string[] = [];
  let lastDraft: DraftEmailOutput | null = null;
  let critic: CritiqueDraftOutput | undefined;
  let iterations = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    iterations = iteration;
    try {
      lastDraft = await runSkill<DraftEmailInput, DraftEmailOutput>("draft-email", {
        target: input.target,
        currentDraft: input.currentDraft,
        preferences: { positive, negative },
        extraConstraints,
      }, ctx);
      skillsUsed.push("draft-email");
    } catch (error) {
      log.warn("social-agent draft-email failed", { error: (error as Error).message });
      return {
        draft: lastDraft?.draft ?? "",
        mode: "local",
        provider: provider.name,
        note: (error as Error).message,
        iterations,
        preferenceExamples: preferenceMeta,
        skillsUsed,
      };
    }

    if (lastDraft.mode === "local") {
      return {
        ...lastDraft,
        iterations,
        preferenceExamples: preferenceMeta,
        skillsUsed,
      };
    }

    try {
      critic = await runSkill<CritiqueDraftInput, CritiqueDraftOutput>("critique-draft", {
        draft: lastDraft.draft,
        target: { name: input.target.name, project: input.target.project, path: input.target.path },
      }, ctx);
      skillsUsed.push("critique-draft");
    } catch (error) {
      log.warn("social-agent critique-draft failed", { error: (error as Error).message });
      break;
    }

    if (!critic || critic.score >= QUALITY_THRESHOLD || iteration === MAX_ITERATIONS) break;
    extraConstraints = critic.issues;
    log.info("social-agent retry on low critic score", { score: critic.score, issues: critic.issues });
  }

  return {
    draft: lastDraft?.draft ?? "",
    mode: lastDraft?.mode ?? "local",
    provider: lastDraft?.provider,
    model: lastDraft?.model,
    cacheHit: lastDraft?.cacheHit,
    critic,
    iterations,
    preferenceExamples: preferenceMeta,
    skillsUsed,
  };
}

export const socialAgent: Agent<SocialAgentInput, SocialAgentOutput> = {
  name: "social-agent",
  description: "Drafts relationship-first cold emails. Conditions on accumulated thumbs-up/down ratings as in-context preference examples (RLHF at the prompt layer). Uses draft-email then critique-draft; retries once if score is below threshold.",
  status: "active",
  skills: SKILLS,
  run: socialRun,
};

registerAgent(socialAgent);
