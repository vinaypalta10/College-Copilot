/**
 * Redis-backed vector store for semantic course search.
 *
 * We embed every course (subject + number + title + description) into a dense
 * vector and cache the whole index in Redis (`cc:vecidx:<term>`). A semantic
 * query is embedded the same way and ranked by cosine similarity.
 *
 * The KNN is computed in Node over the cached vectors, so this works on ANY
 * Redis — no RediSearch / Redis Stack module required — while still using Redis
 * as the durable vector store the hot path reads from. Falls back to building
 * the index from SQLite when Redis is absent (mirrors `courseCache.ts`).
 */

import type { Repo } from "./repo.ts";
import { buildCatalog } from "./courseCache.ts";
import { getRedis, type RedisLike } from "./redis.ts";
import { buildIdf, embed, cosine, EMBED_DIM, type IdfMap } from "../lib/embed.ts";
import { log } from "../lib/log.ts";

export interface VectorIndex {
  term: string;
  dim: number;
  idf: IdfMap;
  vectors: Record<string, number[]>; // course_id -> embedding
  builtAt: string;
}

export interface SemanticHit { courseId: string; score: number }

const INDEX_TTL = Number(process.env.REDIS_VECTOR_TTL || 1800); // seconds
const keyFor = (term: string) => `cc:vecidx:${term}`;

export const vectorStats = { hits: 0, misses: 0, builds: 0, errors: 0 };

/** Text used to represent a course for embedding. */
function courseText(c: { subject: string; number: string; title: string; description: string | null }): string {
  return `${c.subject} ${c.number} ${c.title}. ${c.description ?? ""}`;
}

/** Build the vector index for a term straight from SQLite (source of truth). */
export function buildIndex(repo: Repo, term: string): VectorIndex {
  const { courses } = buildCatalog(repo, term);
  const idf = buildIdf(courses.map(courseText));
  const vectors: Record<string, number[]> = {};
  for (const c of courses) vectors[c.id] = embed(courseText(c), idf);
  vectorStats.builds++;
  return { term, dim: EMBED_DIM, idf, vectors, builtAt: new Date().toISOString() };
}

/** Read-through: serve the index from Redis, building + caching on a miss. */
export async function loadIndex(repo: Repo, term: string, redis?: RedisLike | null): Promise<VectorIndex> {
  const r = redis !== undefined ? redis : await getRedis();
  if (r) {
    try {
      const cached = await r.get(keyFor(term));
      if (cached) {
        vectorStats.hits++;
        return JSON.parse(cached) as VectorIndex;
      }
    } catch (err) {
      vectorStats.errors++;
      log.warn("redis vector read failed", { term, error: (err as Error).message });
    }
  }
  vectorStats.misses++;
  const index = buildIndex(repo, term);
  await writeIndex(index, r);
  return index;
}

export async function writeIndex(index: VectorIndex, redis?: RedisLike | null): Promise<void> {
  const r = redis !== undefined ? redis : await getRedis();
  if (!r) return;
  try {
    await r.set(keyFor(index.term), JSON.stringify(index), { EX: INDEX_TTL });
  } catch (err) {
    vectorStats.errors++;
    log.warn("redis vector write failed", { term: index.term, error: (err as Error).message });
  }
}

/** Rebuild + cache the index (call after an import). */
export async function refreshIndex(repo: Repo, term: string): Promise<{ cached: boolean; vectors: number }> {
  const r = await getRedis();
  const index = buildIndex(repo, term);
  await writeIndex(index, r);
  return { cached: Boolean(r), vectors: Object.keys(index.vectors).length };
}

/** Rank courses by cosine similarity of their vector to the query embedding. */
export function searchIndex(index: VectorIndex, query: string, k = 40): SemanticHit[] {
  const q = embed(query, index.idf);
  const hits: SemanticHit[] = [];
  for (const [courseId, vec] of Object.entries(index.vectors)) {
    hits.push({ courseId, score: cosine(q, vec) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

/** Convenience: load (read-through) then search. */
export async function semanticSearch(repo: Repo, term: string, query: string, k = 40): Promise<SemanticHit[]> {
  const index = await loadIndex(repo, term);
  return searchIndex(index, query, k);
}
