/**
 * context-compressor specialist — the heart of the Token Company story.
 *
 * The deterministic pipeline already did the hard work (search, rank, RMP
 * enrichment, requirement coverage, schedule, workload). Instead of handing the
 * LLM the raw catalog rows (descriptions, every section, every instructor), this
 * agent distills the planning state into the *minimum useful context* and
 * reports the before/after token estimate so the savings are demonstrable.
 *
 * Rule: the LLM should only ever see the compressed context produced here.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { RankedCourse } from "../../../scorer/candidates.ts";
import type { ReqCheckOutput } from "./requirement-checker.ts";
import type { WorkloadOutput } from "./workload-estimator.ts";
import type { QueryConstraints } from "../parseQuery.ts";

/** A single course distilled to only what the explainer needs. */
export interface CompressedCourse {
  code: string;
  title: string;
  score: number;
  topReason: string;
  workload: "light" | "medium" | "heavy";
  profRating: number | null;
  inSchedule: boolean;
}

export interface CompressedContext {
  constraints: QueryConstraints;
  candidates: CompressedCourse[];
  schedule: { courses: string[]; totalUnits: number };
  coverage: ReqCheckOutput["coverage"];
  uncovered: string[];
  workload: WorkloadOutput | null;
}

export interface CompressionStats {
  /** Tokens a naive "dump the catalog rows" prompt would have used. */
  beforeTokens: number;
  /** Tokens the compressed context uses. */
  afterTokens: number;
  ratio: number;
  savedPct: number;
}

export interface CompressInput {
  candidates: RankedCourse[];
  schedule: RankedCourse[];
  coverage: ReqCheckOutput["coverage"];
  uncovered: string[];
  workload: WorkloadOutput | null;
  constraints: QueryConstraints;
  /** How many top candidates to keep in the compressed context. */
  keep?: number;
}

export interface CompressOutput {
  context: CompressedContext;
  stats: CompressionStats;
  summary: string;
}

/** Rough token estimate: ~4 chars/token, good enough for a before/after demo. */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

/** What a naive agent would have stuffed into the prompt: full catalog rows. */
function rawContext(input: CompressInput): unknown {
  return input.candidates.map((rc) => ({
    course: rc.cand.course, // full row incl. description, units, gpa, requirements_satisfied…
    section: rc.cand.section ?? null,
    instructor: rc.cand.instructor ?? null,
    fit: rc.fit, // full reasons + flags + workload rationale
  }));
}

function compressCourse(rc: RankedCourse, inSchedule: boolean): CompressedCourse {
  const c = rc.cand.course;
  return {
    code: `${c.subject} ${c.number}`,
    title: c.title,
    score: Math.round(rc.fit.score),
    topReason: rc.fit.reasons[0] ?? "ranked by overall fit",
    workload: rc.fit.workload.estimate,
    profRating: rc.cand.instructor?.rmp_rating ?? null,
    inSchedule,
  };
}

export function compressContext(input: CompressInput): CompressOutput {
  const keep = input.keep ?? 8;
  const scheduledIds = new Set(input.schedule.map((rc) => rc.cand.course.id));
  const top = input.candidates.slice(0, keep);

  const context: CompressedContext = {
    constraints: input.constraints,
    candidates: top.map((rc) => compressCourse(rc, scheduledIds.has(rc.cand.course.id))),
    schedule: {
      courses: input.schedule.map((rc) => `${rc.cand.course.subject} ${rc.cand.course.number}`),
      totalUnits: input.workload?.totalUnits ?? input.schedule.reduce((s, rc) => s + (rc.cand.course.units ?? 3), 0),
    },
    coverage: input.coverage,
    uncovered: input.uncovered,
    workload: input.workload,
  };

  const beforeTokens = estimateTokens(rawContext(input));
  const afterTokens = estimateTokens(context);
  const ratio = afterTokens > 0 ? beforeTokens / afterTokens : 1;
  const savedPct = beforeTokens > 0 ? Math.round((1 - afterTokens / beforeTokens) * 100) : 0;

  return {
    context,
    stats: { beforeTokens, afterTokens, ratio: Math.round(ratio * 10) / 10, savedPct },
    summary: `Compressed ${input.candidates.length} ranked courses to a ${afterTokens}-token planning context (was ~${beforeTokens} raw; ${savedPct}% smaller, ${Math.round(ratio * 10) / 10}× compression).`,
  };
}

export const contextCompressor: Agent<CompressInput, CompressOutput> = {
  name: "context-compressor",
  description: "Distills the full ranked-course planning state into the minimum useful context for the LLM and reports the before/after token savings (Token Company story).",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(compressContext(input)),
};

registerAgent(contextCompressor);
