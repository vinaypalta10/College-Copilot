/**
 * course-advisor — turns a natural-language request into ranked courses.
 *
 * Pipeline:
 *   1. parse the query into constraint overrides (LLM if a key is present,
 *      otherwise a keyword heuristic)
 *   2. merge overrides onto the student's saved preferences
 *   3. rank the term's catalog with the shared scorer (scoreCourse)
 *   4. return the top matches + a plain-language summary
 *
 * Skills it conceptually uses: course-search (ranking) + professor-rating
 * (ratings already cached at import time).
 */

import { registerAgent } from "./registry.ts";
import type { Agent, AgentContext } from "./types.ts";
import { getProvider } from "../providers/index.ts";
import { prefsFromProfile, rankCourses, type RankedCourse } from "../scorer/candidates.ts";
import type { StudentPrefs } from "../scorer/courseScore.ts";
import { log } from "../lib/log.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

export interface CourseAdvisorInput { userId: string; query: string; term?: string; limit?: number }
export interface CourseAdvisorOutput {
  summary: string;
  constraints: QueryConstraints;
  results: RankedCourse[];
}

interface QueryConstraints {
  subject?: string | null;
  minProfRating?: number | null;
  workloadTolerance?: "light" | "medium" | "heavy" | null;
  earliest?: string | null;
  latest?: string | null;
  daysOff?: string[];
  openOnly?: boolean;
  requirementFocus?: string[];
}

const PARSE_SYSTEM = `You convert a UC Berkeley student's natural-language class-search request into JSON.
Return ONLY a JSON object with any of these keys (omit unknown ones):
  subject (string, dept code like "COMPSCI"),
  minProfRating (number 0-5), workloadTolerance ("light"|"medium"|"heavy"),
  earliest ("HH:MM"), latest ("HH:MM"), daysOff (string[] of M,Tu,W,Th,F),
  openOnly (boolean), requirementFocus (string[]).
Examples: "mornings" -> latest "12:00". "no friday" -> daysOff ["F"].
"manageable/easy" -> workloadTolerance "light". "nothing below 3.5" -> minProfRating 3.5.`;

const SUBJECT_ALIASES: Record<string, string> = {
  cs: "COMPSCI", "computer science": "COMPSCI", eecs: "EECS",
  data: "DATA", "data science": "DATA", ds: "DATA",
  stat: "STAT", statistics: "STAT", math: "MATH",
};

function heuristicParse(q: string): QueryConstraints {
  const s = q.toLowerCase();
  const c: QueryConstraints = {};
  for (const [alias, code] of Object.entries(SUBJECT_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(s)) { c.subject = code; break; }
  }
  if (/\bmorning/.test(s)) c.latest = "12:00";
  if (/\bafternoon/.test(s)) { c.earliest = "12:00"; c.latest = "17:00"; }
  if (/\bevening|night/.test(s)) c.earliest = "17:00";
  if (/manageable|easy|light|chill|low.?workload/.test(s)) c.workloadTolerance = "light";
  if (/hard|heavy|intense|rigorous/.test(s)) c.workloadTolerance = "heavy";
  if (/open|seats|not full/.test(s)) c.openOnly = true;
  const rating = s.match(/(?:above|over|below|at least|minimum|min|no.*below)\s*([0-4](?:\.\d)?)/);
  if (rating?.[1]) c.minProfRating = Number(rating[1]);
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const codes = ["M", "Tu", "W", "Th", "F"];
  const off: string[] = [];
  days.forEach((d, i) => { if (new RegExp(`no ${d}|${d}s?\\s*off|off ${d}`).test(s)) off.push(codes[i]!); });
  if (off.length) c.daysOff = off;
  return c;
}

async function parseQuery(query: string): Promise<QueryConstraints> {
  const provider = getProvider();
  if (!provider.available()) return heuristicParse(query);
  try {
    const res = await provider.chat({
      system: [{ text: PARSE_SYSTEM, cache: true }],
      userMessage: query,
      maxTokens: 300,
      temperature: 0,
    });
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return heuristicParse(query);
    const parsed = JSON.parse(match[0]) as QueryConstraints;
    if (parsed.subject) parsed.subject = (SUBJECT_ALIASES[parsed.subject.toLowerCase()] ?? parsed.subject).toUpperCase();
    return parsed;
  } catch (error) {
    log.warn("advisor LLM parse failed, using heuristic", { error: (error as Error).message });
    return heuristicParse(query);
  }
}

function mergePrefs(base: StudentPrefs, c: QueryConstraints): StudentPrefs {
  return {
    ...base,
    requirementsRemaining: [...(base.requirementsRemaining ?? []), ...(c.requirementFocus ?? [])],
    minProfRating: c.minProfRating ?? base.minProfRating,
    workloadTolerance: c.workloadTolerance ?? base.workloadTolerance,
    timePrefs: {
      earliest: c.earliest ?? base.timePrefs?.earliest,
      latest: c.latest ?? base.timePrefs?.latest,
      daysOff: c.daysOff?.length ? c.daysOff : base.timePrefs?.daysOff,
    },
  };
}

function summarize(c: QueryConstraints, count: number): string {
  const bits: string[] = [];
  if (c.subject) bits.push(`${c.subject} courses`);
  if (c.requirementFocus?.length) bits.push(`for ${c.requirementFocus.join(", ")}`);
  if (c.workloadTolerance) bits.push(`${c.workloadTolerance} workload`);
  if (c.minProfRating) bits.push(`professors rated ≥ ${c.minProfRating}`);
  if (c.latest) bits.push(`ending by ${c.latest}`);
  if (c.earliest) bits.push(`starting after ${c.earliest}`);
  if (c.daysOff?.length) bits.push(`keeping ${c.daysOff.join("/")} free`);
  const filters = bits.length ? bits.join(", ") : "your saved preferences";
  return `Ranked ${count} matches by ${filters}. Top picks are sorted by overall fit — open one to see why.`;
}

export async function advise(input: CourseAdvisorInput, ctx: AgentContext): Promise<CourseAdvisorOutput> {
  const term = input.term ?? DEFAULT_TERM;
  const constraints = await parseQuery(input.query);
  const base = prefsFromProfile(ctx.repo.getProfile(input.userId));
  const prefs = mergePrefs(base, constraints);
  const ranked = rankCourses(ctx.repo, term, prefs, { subject: constraints.subject ?? null, openOnly: constraints.openOnly });
  const limit = input.limit ?? 40;
  return { summary: summarize(constraints, ranked.length), constraints, results: ranked.slice(0, limit) };
}

export const courseAdvisor: Agent<CourseAdvisorInput, CourseAdvisorOutput> = {
  name: "course-advisor",
  description: "Turns a natural-language class-search request into ranked courses, merging parsed constraints with the student's saved preferences.",
  status: "active",
  skills: ["course-search", "professor-rating"],
  run: advise,
};

registerAgent(courseAdvisor);
