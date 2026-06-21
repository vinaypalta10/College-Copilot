/**
 * professor-evaluator specialist — adds real RateMyProfessors signal.
 *
 * For the top candidates whose instructor has no cached rating, it lazily
 * fetches one via the professor-rating skill, then re-scores those candidates so
 * the ranking reflects the new rating. This is genuine added value beyond the
 * initial deterministic pass (which can only use already-cached ratings).
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { enrichInstructor } from "../../skills/professor-rating.ts";
import { instructorKey } from "../../lib/instructors.ts";
import { scoreCourse, type StudentPrefs } from "../../scorer/courseScore.ts";
import type { RankedCourse } from "../../scorer/candidates.ts";

export interface ProfEvalInput { candidates: RankedCourse[]; prefs: StudentPrefs; enrichTop?: number }
export interface ProfEvalOutput { candidates: RankedCourse[]; enriched: number; summary: string }

export async function evaluateProfessors(ctx: AgentContext, input: ProfEvalInput): Promise<ProfEvalOutput> {
  const top = input.candidates.slice(0, input.enrichTop ?? 12);
  let enriched = 0;

  for (const rc of top) {
    const name = rc.cand.section?.instructor;
    if (!name) continue;
    const cached = rc.cand.instructor;
    if (cached?.rmp_rating != null) continue; // already have a rating
    try {
      const r = await enrichInstructor(ctx, name);
      if (r.source === "rmp" || r.source === "cache") {
        const updated = ctx.repo.getInstructor(instructorKey(name));
        if (updated) {
          rc.cand.instructor = updated;
          rc.fit = scoreCourse(rc.cand, input.prefs); // re-score with the new rating
          if (r.source === "rmp") enriched++;
        }
      }
    } catch { /* ignore RMP hiccups — keep the deterministic score */ }
  }

  // Re-sort in case re-scoring changed the order.
  const candidates = [...input.candidates].sort((a, b) => b.fit.score - a.fit.score);
  const rated = candidates.filter(c => c.cand.instructor?.rmp_rating != null).length;
  return {
    candidates,
    enriched,
    summary: `Checked RateMyProfessors for top candidates (${enriched} newly fetched); ${rated} of ${candidates.length} now have a professor rating.`,
  };
}

export const professorEvaluator: Agent<ProfEvalInput, ProfEvalOutput> = {
  name: "professor-evaluator",
  description: "Lazily fetches missing RateMyProfessors ratings for top candidates and re-scores them so good/poor instructors move in the ranking.",
  status: "active",
  skills: ["professor-rating"],
  run: (input, ctx) => evaluateProfessors(ctx, input),
};

registerAgent(professorEvaluator);
