/**
 * Read-through Redis cache for the Berkeley course catalog.
 *
 * The hot path (`GET /api/courses`, the course-finder agent) re-ranks the *whole*
 * catalog against a student's preferences on every request. Building that
 * candidate set means reading all courses + all of the term's sections out of
 * SQLite each time. That raw catalog is identical across users and changes only
 * when we re-import, so it's an ideal thing to cache.
 *
 * We store one JSON blob per term in Redis (`cc:catalog:<term>`); instructor RMP
 * data is intentionally NOT cached here — it's enriched lazily during advising
 * and read live from SQLite so ratings are always fresh.
 *
 * Every Redis call is wrapped: a miss, an error, or no-Redis-configured all fall
 * back to building the snapshot straight from SQLite.
 */

import type { Repo, CourseRow, SectionRow } from "./repo.ts";
import { getRedis, type RedisLike } from "./redis.ts";
import { log } from "../lib/log.ts";

/** Immutable, serializable snapshot of a term's catalog (no per-user data). */
export interface Catalog {
  term: string;
  courses: CourseRow[];
  /** course_id -> its sections for this term. */
  sectionsByCourse: Record<string, SectionRow[]>;
  builtAt: string;
}

const CATALOG_TTL = Number(process.env.REDIS_CATALOG_TTL || 1800); // seconds (30 min)
const keyFor = (term: string) => `cc:catalog:${term}`;

/** Observability for the /api/healthz panel and the demo. */
export const cacheStats = { hits: 0, misses: 0, builds: 0, errors: 0 };

/** Assemble the catalog snapshot straight from SQLite (the fallback / source of truth). */
export function buildCatalog(repo: Repo, term: string): Catalog {
  const sectionsByCourse: Record<string, SectionRow[]> = {};
  for (const s of repo.sectionsForTerm(term)) {
    (sectionsByCourse[s.course_id] ??= []).push(s);
  }
  cacheStats.builds++;
  return { term, courses: repo.listCourses(), sectionsByCourse, builtAt: new Date().toISOString() };
}

/**
 * Return the term's catalog, served from Redis when warm. On a miss we build from
 * SQLite and populate Redis for next time. Always returns a usable catalog.
 */
export async function loadCatalog(repo: Repo, term: string, redis?: RedisLike | null): Promise<Catalog> {
  const r = redis !== undefined ? redis : await getRedis();
  if (r) {
    try {
      const cached = await r.get(keyFor(term));
      if (cached) {
        cacheStats.hits++;
        return JSON.parse(cached) as Catalog;
      }
    } catch (err) {
      cacheStats.errors++;
      log.warn("redis catalog read failed", { term, error: (err as Error).message });
    }
  }

  cacheStats.misses++;
  const catalog = buildCatalog(repo, term);
  await writeCatalog(catalog, r);
  return catalog;
}

/** Persist a freshly built catalog to Redis (best-effort). */
export async function writeCatalog(catalog: Catalog, redis?: RedisLike | null): Promise<void> {
  const r = redis !== undefined ? redis : await getRedis();
  if (!r) return;
  try {
    await r.set(keyFor(catalog.term), JSON.stringify(catalog), { EX: CATALOG_TTL });
  } catch (err) {
    cacheStats.errors++;
    log.warn("redis catalog write failed", { term: catalog.term, error: (err as Error).message });
  }
}

/**
 * Rebuild the cached snapshot for a term (call after an import). Warms Redis so
 * the next request is a hit. Best-effort: silently no-ops without Redis.
 */
export async function refreshCatalog(repo: Repo, term: string): Promise<{ cached: boolean; courses: number }> {
  const r = await getRedis();
  const catalog = buildCatalog(repo, term);
  await writeCatalog(catalog, r);
  return { cached: Boolean(r), courses: catalog.courses.length };
}

/** Drop the cached snapshot for a term (force a rebuild on next read). */
export async function invalidateCatalog(term: string): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  try { await r.del(keyFor(term)); } catch { /* ignore */ }
}
