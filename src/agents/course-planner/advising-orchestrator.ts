import type { AgentContext } from "../types.ts";
import type { RankedCourse } from "../../scorer/candidates.ts";
import { log } from "../../lib/log.ts";
import {
  manageStudentQuery,
  type QueryIntent,
  type QueryConstraints,
} from "./student-query-agent.ts";
import {
  reviewSchoolPolicy,
  type RequirementCoverage,
  type SchoolPolicyOutput,
} from "./school-policy-agent.ts";
import {
  evaluatePlan,
  type PlanningEvaluatorOutput,
} from "./planning-evaluator-agent.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

export interface AdviseInput { userId: string; query: string; term?: string; limit?: number }
export interface AdviceStep { agent: string; ok: boolean; summary: string }
export interface AdviseOutput extends RequirementCoverage {
  summary: string;
  mode: "llm" | "heuristic";
  intent: QueryIntent;
  constraints: QueryConstraints;
  followUp: string | null;
  policy: SchoolPolicyOutput;
  results: RankedCourse[];
  compression: PlanningEvaluatorOutput["compression"];
  steps: AdviceStep[];
}

export async function advise(input: AdviseInput, ctx: AgentContext): Promise<AdviseOutput> {
  const query = await manageStudentQuery({ userId: input.userId, query: input.query }, ctx);
  const policy = reviewSchoolPolicy({ prefs: query.prefs, constraints: query.constraints, baseMajor: query.baseMajor, query: input.query }, ctx);
  const baseSteps: AdviceStep[] = [
    { agent: "student-query-agent", ok: true, summary: query.summary },
    { agent: "school-policy-agent", ok: true, summary: policy.summary },
  ];
  if (query.intent === "policy_question") {
    log.info("course-planner policy response", { agents: baseSteps.length });
    return {
      summary: policy.answer,
      mode: query.mode,
      intent: query.intent,
      constraints: query.constraints,
      followUp: null,
      policy,
      results: [],
      coverage: [],
      uncovered: policy.requirements,
      compression: null,
      steps: baseSteps,
    };
  }
  const evaluation = await evaluatePlan({
    query: input.query,
    term: input.term ?? DEFAULT_TERM,
    prefs: query.prefs,
    constraints: query.constraints,
    policy,
    limit: input.limit,
  }, ctx);

  const steps: AdviceStep[] = [...baseSteps,
    { agent: "planning-evaluator-agent", ok: true, summary: evaluation.judgements.join(" ") }];

  log.info("course-planner complete", { agents: steps.length, candidates: evaluation.results.length, savedPct: evaluation.compression?.savedPct ?? 0 });
  return {
    summary: evaluation.summary,
    mode: evaluation.mode,
    intent: query.intent,
    constraints: query.constraints,
    followUp: query.followUp,
    policy,
    results: evaluation.results,
    coverage: evaluation.coverage,
    uncovered: evaluation.uncovered,
    compression: evaluation.compression,
    steps,
  };
}
