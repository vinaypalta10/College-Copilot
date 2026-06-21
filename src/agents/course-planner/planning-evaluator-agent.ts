import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { rankCoursesCached, type RankedCourse } from "../../scorer/candidates.ts";
import { scoreCourse, type StudentPrefs } from "../../scorer/courseScore.ts";
import { courseLevel } from "../../scorer/requirements.ts";
import { enrichInstructor } from "../../skills/professor-rating.ts";
import { instructorKey } from "../../lib/instructors.ts";
import { getProvider } from "../../providers/index.ts";
import { log } from "../../lib/log.ts";
import { checkRequirements, type RequirementCoverage, type SchoolPolicyOutput } from "./school-policy-agent.ts";
import type { QueryConstraints } from "./student-query-agent.ts";

export interface CompressionStats {
  beforeTokens: number;
  afterTokens: number;
  ratio: number;
  savedPct: number;
}

export interface PlanningEvaluatorInput {
  query: string;
  term: string;
  prefs: StudentPrefs;
  constraints: QueryConstraints;
  policy: SchoolPolicyOutput;
  limit?: number;
}

export interface PlanningEvaluatorOutput extends RequirementCoverage {
  summary: string;
  mode: "llm" | "heuristic";
  results: RankedCourse[];
  compression: CompressionStats | null;
  judgements: string[];
}

async function findAndRank(input: PlanningEvaluatorInput, ctx: AgentContext): Promise<{ candidates: RankedCourse[]; summary: string }> {
  const ranked = await rankCoursesCached(ctx.repo, input.term, input.prefs, {
    subject: input.constraints.subject ?? null,
    openOnly: input.constraints.openOnly ?? false,
    minCourseNumber: input.constraints.minCourseNumber,
    maxCourseNumber: input.constraints.maxCourseNumber,
    allowedDays: input.constraints.allowedDays,
    excludedDays: input.constraints.daysOff,
    topicQuery: input.constraints.topicQuery,
  });
  const terms = [...(input.constraints.keywords ?? []), ...(input.constraints.interests ?? [])]
    .map(term => term.toLowerCase()).filter(Boolean);
  const levelFiltered = ranked.filter(rc => input.policy.level === "any" ||
    (input.policy.level === "graduate" ? courseLevel(rc.cand.course) === "graduate" : courseLevel(rc.cand.course) !== "graduate"));
  const candidates = levelFiltered.map(rc => {
    const course = rc.cand.course;
    const hay = `${course.subject} ${course.number} ${course.title} ${course.description ?? ""}`.toLowerCase();
    const matches = terms.filter(term => hay.includes(term));
    const boosted = !matches.length ? rc : {
      ...rc,
      fit: {
        ...rc.fit,
        score: Math.min(100, rc.fit.score + Math.min(20, matches.length * 12)),
        reasons: [`Matches your requested topic: ${matches.join(", ")}.`, ...rc.fit.reasons],
      },
    };
    return { rc: boosted, topicMatches: matches.length };
  }).sort((a, b) => b.topicMatches - a.topicMatches || b.rc.fit.score - a.rc.fit.score)
    .slice(0, input.limit ?? 40).map(item => item.rc);
  return {
    candidates,
    summary: `Ranked ${levelFiltered.length} ${input.policy.level} course(s)${terms.length ? ` for ${terms.join(", ")}` : ""}; kept top ${candidates.length}.`,
  };
}

async function enrichProfessors(candidates: RankedCourse[], prefs: StudentPrefs, ctx: AgentContext): Promise<{ candidates: RankedCourse[]; summary: string }> {
  let enriched = 0;
  await Promise.all(candidates.slice(0, 8).map(async rc => {
    const name = rc.cand.section?.instructor;
    if (!name || rc.cand.instructor?.rmp_rating != null) return;
    try {
      const result = await enrichInstructor(ctx, name);
      const updated = ctx.repo.getInstructor(instructorKey(name));
      if (updated) {
        rc.cand.instructor = updated;
        rc.fit = scoreCourse(rc.cand, prefs);
        if (result.source === "rmp") enriched++;
      }
    } catch { /* Keep the deterministic score when RMP is unavailable. */ }
  }));
  const sorted = [...candidates].sort((a, b) => b.fit.score - a.fit.score);
  const rated = sorted.filter(item => item.cand.instructor?.rmp_rating != null).length;
  return { candidates: sorted, summary: `Evaluated professors; ${rated}/${sorted.length} candidates have ratings (${enriched} newly fetched).` };
}

function compress(candidates: RankedCourse[], coverage: RequirementCoverage, constraints: QueryConstraints, policy: SchoolPolicyOutput) {
  const raw = candidates.map(rc => ({ course: rc.cand.course, section: rc.cand.section, instructor: rc.cand.instructor, fit: rc.fit }));
  const context = {
    constraints,
    candidates: candidates.slice(0, 8).map(rc => ({
      code: `${rc.cand.course.subject} ${rc.cand.course.number}`,
      title: rc.cand.course.title,
      score: rc.fit.score,
      reason: rc.fit.reasons[0] ?? "overall fit",
      workload: rc.fit.workload.estimate,
      professorRating: rc.cand.instructor?.rmp_rating ?? null,
    })),
    coverage,
    policyWarnings: policy.warnings,
  };
  const beforeTokens = Math.ceil(JSON.stringify(raw).length / 4);
  const afterTokens = Math.ceil(JSON.stringify(context).length / 4);
  const ratio = afterTokens ? beforeTokens / afterTokens : 1;
  const stats: CompressionStats = {
    beforeTokens, afterTokens,
    ratio: Math.round(ratio * 10) / 10,
    savedPct: beforeTokens ? Math.round((1 - afterTokens / beforeTokens) * 100) : 0,
  };
  return { context, stats, summary: `Compressed planning context from ~${beforeTokens} to ${afterTokens} tokens (${stats.savedPct}% smaller).` };
}

function heuristicExplanation(context: ReturnType<typeof compress>["context"]): string {
  const parts: string[] = [];
  const top = context.candidates[0];
  if (context.candidates.length) parts.push(`Top matches: ${context.candidates.slice(0, 3).map(item => item.code).join(", ")}.`);
  if (top) parts.push(`${top.code} leads at ${top.score}/100 because it ${top.reason.charAt(0).toLowerCase()}${top.reason.slice(1)}`);
  if (context.coverage.uncovered.length) parts.push(`Still open: ${context.coverage.uncovered.join(", ")}.`);
  return parts.join(" ") || "No courses matched; try widening the request.";
}

async function explain(query: string, context: ReturnType<typeof compress>["context"]): Promise<{ text: string; mode: "llm" | "heuristic" }> {
  const provider = getProvider();
  if (!provider.available() || !context.candidates.length) return { text: heuristicExplanation(context), mode: "heuristic" };
  try {
    const response = await provider.chat({
      system: [{ text: "Recommend courses from this compact Berkeley catalog context in 3-5 sentences. Do not build a schedule. Use only supplied facts and do not invent policy, requirements, or courses.", cache: true }],
      userMessage: `Request: ${query}\nContext: ${JSON.stringify(context)}`,
      maxTokens: 350,
      temperature: 0.3,
    });
    return response.text.trim() ? { text: response.text.trim(), mode: "llm" } : { text: heuristicExplanation(context), mode: "heuristic" };
  } catch (error) {
    log.warn("plan explanation failed", { error: (error as Error).message });
    return { text: heuristicExplanation(context), mode: "heuristic" };
  }
}

export async function evaluatePlan(input: PlanningEvaluatorInput, ctx: AgentContext): Promise<PlanningEvaluatorOutput> {
  const judgements: string[] = [];
  const found = await findAndRank(input, ctx);
  judgements.push(found.summary);
  const professors = await enrichProfessors(found.candidates, input.prefs, ctx);
  judgements.push(professors.summary);
  const requirements = checkRequirements(professors.candidates, input.policy.requirements);
  judgements.push(`${requirements.coverage.length}/${input.policy.requirements.length} stated requirement(s) have catalog matches.`);
  const compressed = compress(professors.candidates, requirements, input.constraints, input.policy);
  judgements.push(compressed.summary);
  const explanation = await explain(input.query, compressed.context);
  judgements.push(`Final judgement generated from compressed context (${explanation.mode}).`);
  return {
    summary: explanation.text,
    mode: explanation.mode,
    results: professors.candidates,
    ...requirements,
    compression: compressed.stats,
    judgements,
  };
}

export const planningEvaluatorAgent: Agent<PlanningEvaluatorInput, PlanningEvaluatorOutput> = {
  name: "planning-evaluator-agent",
  description: "Owns course retrieval, scoring, professor and per-course workload evaluation, requirement coverage, compression, and final recommendation.",
  status: "active",
  skills: ["course-search", "professor-rating"],
  run: evaluatePlan,
};

registerAgent(planningEvaluatorAgent);
