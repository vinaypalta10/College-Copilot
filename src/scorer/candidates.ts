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
import { parseDayCodes } from "./scheduleBuilder.ts";

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
  minCourseNumber?: number | null;
  maxCourseNumber?: number | null;
  allowedDays?: string[];
  excludedDays?: string[];
  topicQuery?: string | null;
}

export interface RankedCourse { cand: CourseCandidate; fit: FitResult }

function numericCourseNumber(number: string): number | null {
  const match = number.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function topicRelevance(course: CourseCandidate["course"], topicQuery: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const topic = normalize(topicQuery);
  if (!topic) return 0;
  const title = normalize(course.title);
  const description = normalize(course.description || "");
  const tokens = topic.split(" ").filter(token => token.length > 2);
  const phraseMatch = title.includes(topic) || description.includes(topic);
  const matchedTokens = tokens.filter(token => title.includes(token) || description.includes(token));
  const realAnalysisTitle = topic === "real analysis"
    && title.includes("analysis")
    && !/\b(complex|numerical|fourier|harmonic|functional)\b/.test(title);
  if (!phraseMatch && !realAnalysisTitle && tokens.length > 1 && matchedTokens.length < tokens.length) return 0;
  let relevance = 0;
  if (title.includes(topic)) relevance += 45;
  else if (description.includes(topic)) relevance += 30;
  else if (realAnalysisTitle) relevance += 32;
  for (const token of tokens) {
    if (title.includes(token)) relevance += 16;
    else if (description.includes(token)) relevance += 8;
  }
  return Math.min(relevance, 50);
}

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
  if (filters.minCourseNumber != null || filters.maxCourseNumber != null) {
    courses = courses.filter(course => {
      const number = numericCourseNumber(course.number);
      if (number == null) return false;
      if (filters.minCourseNumber != null && number < filters.minCourseNumber) return false;
      if (filters.maxCourseNumber != null && number > filters.maxCourseNumber) return false;
      return true;
    });
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    courses = courses.filter(c => `${c.subject} ${c.number} ${c.title} ${c.description ?? ""}`.toLowerCase().includes(q));
  }

  const ranked = courses.map(course => {
    const section = primarySection(catalog.sectionsByCourse[course.id] ?? []);
    const instructor = section?.instructor ? getInstructor(section.instructor) : undefined;
    const cand: CourseCandidate = { course, section, instructor };
    const fit = scoreCourse(cand, prefs);
    const relevance = filters.topicQuery ? topicRelevance(course, filters.topicQuery) : 0;
    if (relevance > 0) {
      fit.score = Math.min(100, fit.score + relevance);
      fit.reasons.unshift(`Matches your topic: "${filters.topicQuery}".`);
    }
    return { cand, fit, relevance };
  }).filter(({ cand, fit }) => {
    if (fit.flags.completed) return false;
    if (filters.openOnly && cand.section?.status && cand.section.status !== "open") return false;
    if (filters.topicQuery && topicRelevance(cand.course, filters.topicQuery) === 0) return false;
    const meetingDays = parseDayCodes(cand.section?.days);
    if (filters.excludedDays?.some(day => meetingDays.includes(day))) return false;
    if (filters.allowedDays?.length && (!meetingDays.length || meetingDays.some(day => !filters.allowedDays!.includes(day)))) return false;
    return true;
  });

  ranked.sort((a, b) => b.relevance - a.relevance || b.fit.score - a.fit.score);
  return ranked.map(({ cand, fit }) => ({ cand, fit }));
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
