/**
 * Shared course candidate assembly + ranking.
 *
 * Both the /api/courses search and the course-advisor agent build candidates
 * (course + primary section + instructor) and rank them with scoreCourse against
 * a student's preferences. This module is the single source of truth for that.
 */

import type { Repo, StudentProfileRow, SectionRow } from "../db/repo.ts";
import { instructorKey } from "../lib/instructors.ts";
import { scoreCourse, type StudentPrefs, type CourseCandidate, type FitResult } from "./courseScore.ts";
import { buildCatalog, loadCatalog, type Catalog } from "../db/courseCache.ts";

export function prefsFromProfile(p: StudentProfileRow | undefined): StudentPrefs {
  const parse = <T>(s: string | null | undefined, fb: T): T => {
    if (!s) return fb;
    try { return JSON.parse(s) as T; } catch { return fb; }
  };
  return {
    major: p?.major ?? null,
    interests: parse<string[]>(p?.interests, []),
    completedCourses: parse<string[]>(p?.completed_courses, []),
    requirementsRemaining: parse<string[]>(p?.requirements_remaining, []),
    timePrefs: parse<StudentPrefs["timePrefs"]>(p?.time_prefs, {}),
    workloadTolerance: (p?.workload_tolerance as StudentPrefs["workloadTolerance"]) ?? null,
    minProfRating: p?.min_prof_rating ?? null,
  };
}

/** Pick the lecture/primary section for a course (prefer LEC, then first). */
export function primarySection(sections: SectionRow[]): SectionRow | undefined {
  if (!sections.length) return undefined;
  return sections.find(s => (s.component ?? "").toUpperCase() === "LEC") ?? sections[0];
}

export interface RankFilters {
  subject?: string | null;
  q?: string | null;
  openOnly?: boolean;
}

export interface RankedCourse { cand: CourseCandidate; fit: FitResult }

/** How to resolve an instructor row by name — SQLite point lookup (RMP cache). */
type InstructorLookup = (name: string) => CourseCandidate["instructor"];

/**
 * Pure ranking over a prebuilt catalog snapshot. Instructor RMP data is resolved
 * live (so freshly enriched ratings show immediately) while the bulk catalog can
 * come from the Redis cache.
 */
export function rankCatalog(
  catalog: Catalog,
  prefs: StudentPrefs,
  filters: RankFilters,
  getInstructor: InstructorLookup,
): RankedCourse[] {
  let courses = catalog.courses;
  if (filters.subject) courses = courses.filter(c => c.subject.toUpperCase() === filters.subject!.toUpperCase());
  if (filters.q) {
    const q = filters.q.toLowerCase();
    courses = courses.filter(c => `${c.subject} ${c.number} ${c.title} ${c.description ?? ""}`.toLowerCase().includes(q));
  }

  const ranked = courses.map(course => {
    const section = primarySection(catalog.sectionsByCourse[course.id] ?? []);
    const instructor = section?.instructor ? getInstructor(section.instructor) : undefined;
    const cand: CourseCandidate = { course, section, instructor };
    return { cand, fit: scoreCourse(cand, prefs) };
  }).filter(({ cand, fit }) => {
    if (fit.flags.completed) return false;
    if (filters.openOnly && cand.section?.status && cand.section.status !== "open") return false;
    return true;
  });

  ranked.sort((a, b) => b.fit.score - a.fit.score);
  return ranked;
}

/** Build + rank all courses for a term against prefs (synchronous, SQLite-direct). */
export function rankCourses(repo: Repo, term: string, prefs: StudentPrefs, filters: RankFilters = {}): RankedCourse[] {
  return rankCatalog(buildCatalog(repo, term), prefs, filters, name => repo.getInstructor(instructorKey(name)));
}

/**
 * Same as `rankCourses`, but the catalog comes from the Redis read-through cache
 * when available (falling back to SQLite). Use this on request hot paths.
 */
export async function rankCoursesCached(repo: Repo, term: string, prefs: StudentPrefs, filters: RankFilters = {}): Promise<RankedCourse[]> {
  const catalog = await loadCatalog(repo, term);
  return rankCatalog(catalog, prefs, filters, name => repo.getInstructor(instructorKey(name)));
}
