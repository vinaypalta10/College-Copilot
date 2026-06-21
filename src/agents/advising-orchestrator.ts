/**
 * advising-orchestrator — the planner of the multi-agent discovery system.
 *
 * Flow: parse the request → merge with the student's profile → delegate to
 * specialist agents (course-finder → professor-evaluator → requirement-checker
 * → schedule-builder → workload-estimator) → synthesize a recommendation.
 *
 * It returns a step-by-step `trace` so the UI (and judges) can see the agents
 * collaborating. Every delegation is wrapped so one specialist failing degrades
 * gracefully instead of breaking the whole run. Deterministic tools do the
 * computing; the agents reason, enrich, and explain.
 */

import { registerAgent } from "./registry.ts";
import type { Agent, AgentContext } from "./types.ts";
import { parseQuery, mergePrefs, type QueryConstraints } from "./parseQuery.ts";
import { prefsFromProfile, type RankedCourse } from "../scorer/candidates.ts";
import { findCourses } from "./specialists/course-finder.ts";
import { evaluateProfessors } from "./specialists/professor-evaluator.ts";
import { checkRequirements, type ReqCheckOutput } from "./specialists/requirement-checker.ts";
import { buildFromCandidates, type SchedBuildOutput } from "./specialists/schedule-builder.ts";
import { estimateScheduleWorkload, type WorkloadOutput } from "./specialists/workload-estimator.ts";
import { log } from "../lib/log.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

export interface AdviseInput { userId: string; query: string; term?: string; limit?: number }
export interface AdviceStep { agent: string; ok: boolean; summary: string }
export interface AdviseOutput {
  summary: string;
  mode: "llm" | "heuristic";
  constraints: QueryConstraints;
  results: RankedCourse[];
  schedule: RankedCourse[];
  coverage: ReqCheckOutput["coverage"];
  uncovered: string[];
  workload: WorkloadOutput | null;
  steps: AdviceStep[];
}

export async function advise(input: AdviseInput, ctx: AgentContext): Promise<AdviseOutput> {
  const term = input.term ?? DEFAULT_TERM;
  const steps: AdviceStep[] = [];
  const record = (agent: string, ok: boolean, summary: string) => steps.push({ agent, ok, summary });

  // 1. Plan: parse the request into constraints + merge with the saved profile.
  const { constraints, mode } = await parseQuery(input.query);
  const prefs = mergePrefs(prefsFromProfile(ctx.repo.getProfile(input.userId)), constraints);
  record("planner", true, `Parsed request (${mode}); planning course-finder → professor-evaluator → requirement-checker → schedule-builder → workload-estimator.`);

  // 2. course-finder
  let candidates: RankedCourse[] = [];
  try {
    const found = await findCourses(ctx, { prefs, term, subject: constraints.subject ?? null, openOnly: constraints.openOnly, limit: input.limit ?? 40 });
    candidates = found.candidates;
    record("course-finder", true, found.summary);
  } catch (e) {
    record("course-finder", false, `failed: ${(e as Error).message}`);
    return { summary: "No courses available — try importing more subjects.", mode, constraints, results: [], schedule: [], coverage: [], uncovered: [], workload: null, steps };
  }

  // 3. professor-evaluator (lazy RMP enrichment + re-score)
  try {
    const evald = await evaluateProfessors(ctx, { candidates, prefs });
    candidates = evald.candidates;
    record("professor-evaluator", true, evald.summary);
  } catch (e) {
    record("professor-evaluator", false, `skipped: ${(e as Error).message}`);
  }

  // 4. requirement-checker
  let coverage: ReqCheckOutput["coverage"] = [];
  let uncovered: string[] = [];
  try {
    const rc = checkRequirements({ candidates, requirementsRemaining: prefs.requirementsRemaining ?? [] });
    coverage = rc.coverage; uncovered = rc.uncovered;
    record("requirement-checker", true, rc.summary);
  } catch (e) {
    record("requirement-checker", false, `skipped: ${(e as Error).message}`);
  }

  // 5. schedule-builder
  let schedule: RankedCourse[] = [];
  let sched: SchedBuildOutput | null = null;
  try {
    sched = buildFromCandidates({ candidates, maxUnits: 18 });
    schedule = sched.chosen;
    record("schedule-builder", true, sched.summary);
  } catch (e) {
    record("schedule-builder", false, `skipped: ${(e as Error).message}`);
  }

  // 6. workload-estimator (on the proposed schedule)
  let workload: WorkloadOutput | null = null;
  if (schedule.length) {
    try {
      workload = estimateScheduleWorkload({ schedule });
      record("workload-estimator", true, workload.summary);
    } catch (e) {
      record("workload-estimator", false, `skipped: ${(e as Error).message}`);
    }
  }

  const summary = synthesize(candidates.length, coverage, sched, workload);
  log.info("advising-orchestrator complete", { steps: steps.length, candidates: candidates.length });
  return { summary, mode, constraints, results: candidates, schedule, coverage, uncovered, workload, steps };
}

function synthesize(count: number, coverage: ReqCheckOutput["coverage"], sched: SchedBuildOutput | null, workload: WorkloadOutput | null): string {
  const parts = [`Ranked ${count} courses for you.`];
  if (coverage.length) parts.push(`They cover ${coverage.length} of your remaining requirement(s).`);
  if (sched && sched.chosen.length) parts.push(`I drafted a conflict-free ${sched.totalUnits}-unit schedule (${sched.chosen.map(c => `${c.cand.course.subject} ${c.cand.course.number}`).join(", ")}).`);
  if (workload) parts.push(workload.summary);
  return parts.join(" ");
}

export const advisingOrchestrator: Agent<AdviseInput, AdviseOutput> = {
  name: "advising-orchestrator",
  description: "Plans and runs the multi-agent course-advising pipeline, returning ranked courses, a conflict-free schedule, requirement coverage, and a step-by-step agent trace.",
  status: "active",
  skills: ["course-search", "professor-rating"],
  delegatesTo: ["course-finder", "professor-evaluator", "requirement-checker", "schedule-builder", "workload-estimator"],
  run: advise,
};

registerAgent(advisingOrchestrator);
