import { Router } from "express";
import { Repo, type SectionRow } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { instructorKey } from "../lib/instructors.ts";
import { scoreCourse, type CourseCandidate } from "../scorer/courseScore.ts";
import { prefsFromProfile, primarySection, rankCoursesCached } from "../scorer/candidates.ts";
import { loadCatalog } from "../db/courseCache.ts";
import { semanticSearch } from "../db/vectorStore.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

export function coursesRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.use(requireAuth);

  router.get("/subjects", (_req, res) => {
    res.json({ subjects: repo.listCourseSubjects() });
  });

  router.get("/", async (req: AuthedRequest, res) => {
    const term = String(req.query.term ?? DEFAULT_TERM);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const q = req.query.q ? String(req.query.q) : null;
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));

    // Semantic "find classes like…" mode: rank by embedding similarity (Redis
    // vector store) instead of substring match, then attach the fit score.
    if (q && req.query.semantic === "true") {
      const out = await semanticRank(repo, term, q, prefs, {
        subject: req.query.subject ? String(req.query.subject) : null,
        openOnly: req.query.openOnly === "true",
        limit,
      });
      res.json({ term, mode: "semantic", count: out.length, courses: out });
      return;
    }

    const ranked = await rankCoursesCached(repo, term, prefs, {
      subject: req.query.subject ? String(req.query.subject) : null,
      q,
      openOnly: req.query.openOnly === "true",
    });
    res.json({
      term,
      mode: "keyword",
      count: ranked.length,
      offset,
      courses: ranked.slice(offset, offset + limit).map(({ cand, fit }) => shapeCourse(cand, fit)),
    });
  });

  router.get("/:id", (req: AuthedRequest, res) => {
    const term = String(req.query.term ?? DEFAULT_TERM);
    const course = repo.getCourse(String(req.params.id));
    if (!course) { res.status(404).json({ error: "course not found" }); return; }
    const sections = repo.sectionsForCourse(course.id, term);
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));
    const section = primarySection(sections);
    const instructor = section?.instructor ? repo.getInstructor(instructorKey(section.instructor)) : undefined;
    const cand: CourseCandidate = { course, section, instructor };
    const fit = scoreCourse(cand, prefs);
    res.json({
      course: shapeCourse(cand, fit),
      sections: sections.map(shapeSection),
    });
  });

  return router;
}

export function shapeSection(s: SectionRow) {
  return {
    id: s.id, component: s.component, instructor: s.instructor,
    days: s.days, startMin: s.start_min, endMin: s.end_min, location: s.location,
    enrolled: s.enrolled, cap: s.enroll_cap, waitlist: s.waitlist, status: s.status,
  };
}

export function shapeCourse(c: CourseCandidate, fit: ReturnType<typeof scoreCourse>) {
  const reqs = c.course.requirements_satisfied ? safeArr(c.course.requirements_satisfied) : [];
  return {
    id: c.course.id,
    subject: c.course.subject,
    number: c.course.number,
    title: c.course.title,
    units: c.course.units,
    description: c.course.description,
    prerequisites: c.course.prerequisites,
    avgGpa: c.course.avg_gpa,
    requirementsSatisfied: reqs,
    section: c.section ? shapeSection(c.section) : null,
    instructor: c.instructor ? {
      name: c.instructor.name,
      rmpRating: c.instructor.rmp_rating,
      rmpDifficulty: c.instructor.rmp_difficulty,
      rmpWouldTakeAgain: c.instructor.rmp_would_take_again,
    } : (c.section?.instructor ? { name: c.section.instructor, rmpRating: null, rmpDifficulty: null, rmpWouldTakeAgain: null } : null),
    fit: { score: fit.score, reasons: fit.reasons, flags: fit.flags, workload: fit.workload },
  };
}

/**
 * Embedding-similarity ranking over the Redis vector store, then enriched with
 * the deterministic fit score. Returns shaped courses with a `similarity` field,
 * ordered by semantic relevance to the query.
 */
async function semanticRank(
  repo: Repo,
  term: string,
  query: string,
  prefs: ReturnType<typeof prefsFromProfile>,
  filters: { subject: string | null; openOnly: boolean; limit: number },
) {
  // Over-fetch so post-filters (subject/openOnly/completed) still leave a full page.
  const hits = await semanticSearch(repo, term, query, filters.limit * 4 + 40);
  const catalog = await loadCatalog(repo, term);
  const courseById = new Map(catalog.courses.map(c => [c.id, c]));

  const out: Array<ReturnType<typeof shapeCourse> & { similarity: number }> = [];
  for (const hit of hits) {
    const course = courseById.get(hit.courseId);
    if (!course) continue;
    if (filters.subject && course.subject.toUpperCase() !== filters.subject.toUpperCase()) continue;
    const section = primarySection(catalog.sectionsByCourse[course.id] ?? []);
    const instructor = section?.instructor ? repo.getInstructor(instructorKey(section.instructor)) : undefined;
    const cand: CourseCandidate = { course, section, instructor };
    const fit = scoreCourse(cand, prefs);
    if (fit.flags.completed) continue;
    if (filters.openOnly && section?.status && section.status !== "open") continue;
    out.push({ ...shapeCourse(cand, fit), similarity: Math.round(hit.score * 1000) / 1000 });
    if (out.length >= filters.limit) break;
  }
  return out;
}

function safeArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
