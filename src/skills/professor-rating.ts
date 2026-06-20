/**
 * professor-rating skill — atomic tool.
 *
 * Looks up a Berkeley instructor's RateMyProfessors stats, caching results on
 * the `instructors` table. Re-fetches only when missing or older than the TTL.
 */

import { registerSkill, type Skill, type SkillContext } from "./registry.ts";
import { fetchRmpRating } from "../ingest/ratemyprofessors.ts";
import { instructorKey } from "../lib/instructors.ts";
import type { InstructorRow } from "../db/repo.ts";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ProfessorRatingInput { name: string; force?: boolean }
export interface ProfessorRatingOutput {
  name: string;
  rating: number | null;
  difficulty: number | null;
  wouldTakeAgain: number | null;
  numRatings: number | null;
  source: "cache" | "rmp" | "none";
}

function shape(row: InstructorRow, source: ProfessorRatingOutput["source"]): ProfessorRatingOutput {
  return {
    name: row.name,
    rating: row.rmp_rating,
    difficulty: row.rmp_difficulty,
    wouldTakeAgain: row.rmp_would_take_again,
    numRatings: row.rmp_num_ratings,
    source,
  };
}

export async function enrichInstructor(ctx: SkillContext, name: string, force = false): Promise<ProfessorRatingOutput> {
  const id = instructorKey(name);
  const existing = ctx.repo.getInstructor(id);
  const fresh = existing?.fetched_at && Date.now() - new Date(existing.fetched_at).getTime() < TTL_MS;
  if (existing && fresh && !force) return shape(existing, "cache");

  let rmp = null;
  try { rmp = await fetchRmpRating(name); } catch { /* network/RMP hiccup — fall back to cache */ }
  if (!rmp) {
    if (existing) return shape(existing, "cache");
    return { name, rating: null, difficulty: null, wouldTakeAgain: null, numRatings: null, source: "none" };
  }

  const row: InstructorRow = {
    id,
    name,
    rmp_rating: rmp.avgRating,
    rmp_difficulty: rmp.avgDifficulty,
    rmp_would_take_again: rmp.wouldTakeAgainPercent,
    rmp_num_ratings: rmp.numRatings,
    avg_gpa: existing?.avg_gpa ?? null,
    grade_distribution: existing?.grade_distribution ?? null,
    fetched_at: new Date().toISOString(),
  };
  ctx.repo.upsertInstructor(row);
  return shape(row, "rmp");
}

export const professorRating: Skill<ProfessorRatingInput, ProfessorRatingOutput> = {
  name: "professor-rating",
  description: "Fetch a Berkeley instructor's RateMyProfessors rating, difficulty, and would-take-again %, cached on the instructors table (30-day TTL).",
  status: "active",
  run: (input, ctx) => enrichInstructor(ctx, input.name, input.force),
};

registerSkill(professorRating);
