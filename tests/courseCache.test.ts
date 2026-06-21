import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Repo, type CourseRow, type SectionRow } from "../src/db/repo.ts";
import { buildCatalog, loadCatalog, writeCatalog } from "../src/db/courseCache.ts";
import type { RedisLike } from "../src/db/redis.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "src", "db", "schema.sql"), "utf8");

function freshDb(): { repo: Repo; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cc-cache-test-"));
  const db = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  return { repo: new Repo(db), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function course(over: Partial<CourseRow> = {}): CourseRow {
  return {
    id: "compsci-61a", subject: "COMPSCI", number: "61A", title: "SICP",
    units: 4, description: "intro", requirements_satisfied: null, terms_offered: null,
    prerequisites: null, avg_gpa: 3.3, updated_at: null, ...over,
  };
}

function section(over: Partial<SectionRow> = {}): SectionRow {
  return {
    id: "compsci-61a-fall-2026-lec", course_id: "compsci-61a", term: "fall-2026",
    class_number: null, component: "LEC", instructor: "John DeNero", days: "MWF",
    start_min: 600, end_min: 660, location: "Wheeler", enroll_cap: 500, enrolled: 480,
    waitlist: 0, status: "open", updated_at: null, ...over,
  };
}

/** Minimal in-memory stand-in for the slice of node-redis we use. */
function fakeRedis(): RedisLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k)! : null; },
    async set(k, v) { store.set(k, v); return "OK"; },
    async del(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      let n = 0;
      for (const k of arr) if (store.delete(k)) n++;
      return n;
    },
  };
}

test("buildCatalog assembles courses + sections from SQLite", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertCourse(course());
    repo.upsertSection(section());
    const cat = buildCatalog(repo, "fall-2026");
    assert.equal(cat.courses.length, 1);
    assert.equal(cat.sectionsByCourse["compsci-61a"]!.length, 1);
    assert.equal(cat.term, "fall-2026");
  } finally { cleanup(); }
});

test("loadCatalog populates Redis on miss, then serves from it on hit", async () => {
  const { repo, cleanup } = freshDb();
  const redis = fakeRedis();
  try {
    repo.upsertCourse(course());
    repo.upsertSection(section());

    // Miss: builds from SQLite and writes through to Redis.
    const first = await loadCatalog(repo, "fall-2026", redis);
    assert.equal(first.courses.length, 1);
    assert.equal(redis.store.size, 1, "catalog should be cached after a miss");

    // Mutate SQLite, but the cached blob should still be served (proving the hit).
    repo.upsertCourse(course({ id: "compsci-61b", number: "61B", title: "Data Structures" }));
    const second = await loadCatalog(repo, "fall-2026", redis);
    assert.equal(second.courses.length, 1, "served the cached snapshot, not the new DB state");
  } finally { cleanup(); }
});

test("loadCatalog falls back to SQLite when Redis is absent (null client)", async () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertCourse(course());
    const cat = await loadCatalog(repo, "fall-2026", null);
    assert.equal(cat.courses.length, 1);
  } finally { cleanup(); }
});

test("loadCatalog tolerates a throwing Redis client and still returns data", async () => {
  const { repo, cleanup } = freshDb();
  const broken: RedisLike = {
    async get() { throw new Error("connection reset"); },
    async set() { throw new Error("connection reset"); },
    async del() { throw new Error("connection reset"); },
  };
  try {
    repo.upsertCourse(course());
    const cat = await loadCatalog(repo, "fall-2026", broken);
    assert.equal(cat.courses.length, 1, "errors fall back to SQLite");
  } finally { cleanup(); }
});

test("writeCatalog is a no-op without a client", async () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertCourse(course());
    await writeCatalog(buildCatalog(repo, "fall-2026"), null); // must not throw
  } finally { cleanup(); }
});
