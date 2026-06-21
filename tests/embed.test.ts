import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { tokenize, embed, cosine, buildIdf, EMBED_DIM } from "../src/lib/embed.ts";
import { Repo, type CourseRow } from "../src/db/repo.ts";
import { buildIndex, searchIndex, loadIndex } from "../src/db/vectorStore.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "src", "db", "schema.sql"), "utf8");

function freshRepo(): { repo: Repo; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "cc-embed-test-"));
  const db = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  return { repo: new Repo(db), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function course(id: string, subject: string, number: string, title: string, description: string): CourseRow {
  return {
    id, subject, number, title, units: 4, description,
    requirements_satisfied: null, terms_offered: null, prerequisites: null,
    avg_gpa: 3.3, updated_at: null,
  };
}

test("tokenize drops stopwords and short tokens", () => {
  assert.deepEqual(tokenize("Introduction to the Machine Learning"), ["machine", "learning"]);
});

test("embed is deterministic and unit-length", () => {
  const idf = buildIdf(["machine learning", "organic chemistry"]);
  const a = embed("machine learning", idf);
  const b = embed("machine learning", idf);
  assert.deepEqual(a, b);
  assert.equal(a.length, EMBED_DIM);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, "embedding should be L2-normalized");
});

test("cosine: similar text scores higher than unrelated text", () => {
  const idf = buildIdf([
    "machine learning neural networks",
    "deep learning artificial intelligence",
    "organic chemistry reactions",
  ]);
  const query = embed("artificial intelligence and machine learning", idf);
  const ml = embed("machine learning neural networks", idf);
  const chem = embed("organic chemistry reactions", idf);
  assert.ok(cosine(query, ml) > cosine(query, chem), "ML doc should beat chemistry doc");
});

test("searchIndex ranks the most relevant course first", () => {
  const { repo, cleanup } = freshRepo();
  try {
    repo.upsertCourse(course("compsci-189", "COMPSCI", "189", "Introduction to Machine Learning", "Theory and practice of machine learning, neural networks, classification."));
    repo.upsertCourse(course("chem-1a", "CHEM", "1A", "General Chemistry", "Atoms, molecules, chemical reactions and stoichiometry."));
    repo.upsertCourse(course("music-27", "MUSIC", "27", "Introduction to Music", "Listening to and understanding Western classical music."));

    const index = buildIndex(repo, "fall-2026");
    const hits = searchIndex(index, "I want to learn about neural networks and AI", 3);
    assert.equal(hits[0]!.courseId, "compsci-189");
    assert.ok(hits[0]!.score > hits[1]!.score);
  } finally { cleanup(); }
});

test("loadIndex falls back to building from SQLite when Redis is null", async () => {
  const { repo, cleanup } = freshRepo();
  try {
    repo.upsertCourse(course("stat-134", "STAT", "134", "Concepts of Probability", "Random variables, distributions, expectation."));
    const index = await loadIndex(repo, "fall-2026", null);
    assert.equal(Object.keys(index.vectors).length, 1);
    assert.equal(index.dim, EMBED_DIM);
  } finally { cleanup(); }
});
