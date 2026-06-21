/**
 * course-finder specialist — constraints → ranked candidate courses.
 *
 * Thin agent over the deterministic ranker (rankCourses/scoreCourse); it never
 * invents course data, it filters and orders the real catalog.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { rankCourses, type RankedCourse } from "../../scorer/candidates.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";

export interface CourseFinderInput {
  prefs: StudentPrefs;
  term: string;
  subject?: string | null;
  openOnly?: boolean;
  limit?: number;
}
export interface CourseFinderOutput { candidates: RankedCourse[]; total: number; summary: string }

export function findCourses(ctx: AgentContext, input: CourseFinderInput): CourseFinderOutput {
  const ranked = rankCourses(ctx.repo, input.term, input.prefs, {
    subject: input.subject ?? null,
    openOnly: input.openOnly ?? false,
  });
  const candidates = ranked.slice(0, input.limit ?? 40);
  return {
    candidates,
    total: ranked.length,
    summary: `Found ${ranked.length} matching courses${input.subject ? ` in ${input.subject}` : ""}; kept top ${candidates.length}.`,
  };
}

export const courseFinder: Agent<CourseFinderInput, CourseFinderOutput> = {
  name: "course-finder",
  description: "Searches and ranks the live Berkeley catalog against the student's merged preferences (deterministic scorer).",
  status: "active",
  skills: ["course-search"],
  run: (input, ctx) => Promise.resolve(findCourses(ctx, input)),
};

registerAgent(courseFinder);
