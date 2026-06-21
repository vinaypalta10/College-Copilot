/**
 * requirement-checker specialist — cross-course requirement coverage.
 *
 * The per-course scorer flags whether a course matches *some* remaining
 * requirement; this agent aggregates across candidates to answer "which of my
 * remaining requirements can these courses cover, and which are still open?".
 */

import { registerAgent } from "../../registry.ts";
import type { Agent, AgentContext } from "../../types.ts";
import type { RankedCourse } from "../../../scorer/candidates.ts";

export interface ReqCheckInput { candidates: RankedCourse[]; requirementsRemaining: string[] }
export interface ReqCheckOutput {
  coverage: Array<{ requirement: string; courses: string[] }>;
  uncovered: string[];
  summary: string;
}

function norm(s: string): string { return s.toUpperCase().replace(/\s+/g, " ").trim(); }

export function checkRequirements(input: ReqCheckInput): ReqCheckOutput {
  const reqs = input.requirementsRemaining ?? [];
  const coverage: ReqCheckOutput["coverage"] = [];
  const uncovered: string[] = [];

  for (const req of reqs) {
    const tokens = norm(req).split(/[^A-Z0-9]+/).filter(t => t.length > 2);
    const courses: string[] = [];
    for (const rc of input.candidates) {
      const c = rc.cand.course;
      const hay = norm(`${c.subject} ${c.number} ${c.title} ${c.description ?? ""} ${c.requirements_satisfied ?? ""}`);
      if (tokens.some(t => hay.includes(t))) courses.push(`${c.subject} ${c.number}`);
      if (courses.length >= 5) break;
    }
    if (courses.length) coverage.push({ requirement: req, courses });
    else uncovered.push(req);
  }

  const summary = reqs.length
    ? `${coverage.length}/${reqs.length} of your remaining requirements are covered by these courses${uncovered.length ? `; still open: ${uncovered.join(", ")}` : ""}.`
    : "No remaining requirements set — add them in your profile for requirement-aware ranking.";
  return { coverage, uncovered, summary };
}

export const requirementChecker: Agent<ReqCheckInput, ReqCheckOutput> = {
  name: "requirement-checker",
  description: "Maps candidate courses to the student's remaining requirements and reports coverage + still-open requirements.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(checkRequirements(input)),
};

registerAgent(requirementChecker);
