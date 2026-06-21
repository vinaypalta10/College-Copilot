/**
 * Import UC Berkeley courses + sections for a term from Berkeleytime into SQLite.
 *
 * Usage:
 *   npm run import:courses                      # TERM env or fall-2026, default subjects
 *   npm run import:courses -- --term fall-2026 --subjects COMPSCI,DATA,STAT,MATH
 *   npm run import:courses -- --limit 40        # cap courses (quick demo import)
 *
 * Idempotent: re-running upserts. Instructor RMP/grade enrichment happens lazily
 * elsewhere; here we just seed instructor rows with names + course grade averages.
 */

import { getDb } from "../db/client.ts";
import { Repo } from "../db/repo.ts";
import { parseTerm, listCourseKeys, fetchCourseDetail } from "../ingest/berkeleytime.ts";
import { instructorKey } from "../lib/instructors.ts";
import { enrichInstructor } from "../skills/professor-rating.ts";
import { refreshCatalog } from "../db/courseCache.ts";
import { refreshIndex } from "../db/vectorStore.ts";
import { closeRedis } from "../db/redis.ts";

// A broad, demo-rich slice of Berkeley spanning every college: CS/EECS/data,
// engineering, the physical & life sciences, social sciences, humanities, and
// business. `npm run import:courses` pulls all of these by default.
const DEFAULT_SUBJECTS = [
  // Computing, data & math
  "COMPSCI", "EECS", "ELENG", "DATA", "DATASCI", "INFO", "STAT", "MATH",
  // Physical sciences & engineering
  "PHYSICS", "ASTRON", "CHEM", "MECENG", "CIVENG", "INDENG", "BIOENG", "MATSCI", "NUCENG",
  // Life & health sciences
  "MCELLBI", "INTEGBI", "NEU", "PBHLTH", "NUSCTX",
  // Mind & behavior
  "COGSCI", "PSYCH", "LINGUIS",
  // Social sciences
  "ECON", "POLSCI", "SOCIOL", "ANTHRO", "LEGALST", "GEOG", "ENVECON",
  // Humanities & arts
  "ENGLISH", "HISTORY", "PHILOS", "MUSIC", "FILM", "ART", "COMLIT",
  // Business
  "UGBA",
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  const term = parseTerm(arg("term") || process.env.COURSE_TERM || "fall-2026");
  const subjects = (arg("subjects") || DEFAULT_SUBJECTS.join(",")).split(",").map(s => s.trim()).filter(Boolean);
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  // Per-subject cap keeps coverage even across many departments (so one huge
  // department doesn't crowd out the rest). Defaults to 40.
  const perSubject = arg("per-subject") ? Number(arg("per-subject")) : 40;
  const concurrency = Number(arg("concurrency") || 6);

  console.log(`Importing ${term.term} for ${subjects.length} subjects: ${subjects.join(", ")}`);

  const db = getDb();
  const repo = new Repo(db);

  let keys = await listCourseKeys(term, subjects);
  console.log(`Found ${keys.length} distinct courses in catalog.`);

  // Cap per subject for even breadth, then optionally cap the grand total.
  if (Number.isFinite(perSubject)) {
    const perSubjectCount = new Map<string, number>();
    keys = keys.filter(k => {
      const n = (perSubjectCount.get(k.subject) ?? 0) + 1;
      perSubjectCount.set(k.subject, n);
      return n <= perSubject;
    });
    console.log(`Capped to ${keys.length} courses (≤${perSubject} per subject).`);
  }
  if (Number.isFinite(limit)) keys = keys.slice(0, limit);

  let courses = 0, sections = 0, instructors = 0, errors = 0;
  const seenInstructors = new Set<string>();

  await pool(keys, concurrency, async (key, i) => {
    try {
      const detail = await fetchCourseDetail(key.subject, key.courseNumber, term);
      if (!detail) return;
      repo.upsertCourse(detail.course);
      courses++;
      for (const s of detail.sections) { repo.upsertSection(s); sections++; }
      for (const name of detail.instructorNames) {
        const id = instructorKey(name);
        if (!id || seenInstructors.has(id)) continue;
        seenInstructors.add(id);
        if (!repo.getInstructor(id)) {
          repo.upsertInstructor({
            id, name,
            rmp_rating: null, rmp_difficulty: null, rmp_would_take_again: null,
            rmp_num_ratings: null, avg_gpa: null, grade_distribution: null, fetched_at: null,
          });
          instructors++;
        }
      }
      if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${keys.length}`);
    } catch (error) {
      errors++;
      if (errors <= 5) console.warn(`  ! ${key.subject} ${key.courseNumber}: ${(error as Error).message}`);
    }
  });

  console.log(`Done: ${courses} courses, ${sections} sections, ${instructors} new instructors, ${errors} errors.`);

  // RateMyProfessors enrichment pass (skip with --no-rmp). Resilient: RMP misses
  // don't fail the import.
  if (!process.argv.includes("--no-rmp")) {
    const names = [...seenInstructors].map(id => repo.getInstructor(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map(r => r.name);
    console.log(`Enriching ${names.length} instructors from RateMyProfessors...`);
    let rated = 0;
    await pool(names, 4, async (name) => {
      const r = await enrichInstructor({ repo }, name).catch(() => null);
      if (r && r.rating != null) rated++;
    });
    console.log(`RMP: ${rated}/${names.length} instructors rated.`);
  }

  // Warm the Redis course-catalog cache + semantic vector index so the app
  // serves both from Redis immediately.
  const refreshed = await refreshCatalog(repo, term.term);
  if (refreshed.cached) {
    const vec = await refreshIndex(repo, term.term);
    console.log(`Redis: warmed catalog cache (${refreshed.courses} courses) + vector index (${vec.vectors} embeddings) for ${term.term}.`);
  } else {
    console.log(`Redis: not configured — set REDIS_URL to cache the catalog + vector index.`);
  }
  await closeRedis();
}

main().catch(async error => {
  console.error("Import failed:", error);
  await closeRedis();
  process.exit(1);
});
