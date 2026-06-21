import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, type TargetRow } from "../src/db/repo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "src", "db", "schema.sql");
const schema = readFileSync(schemaPath, "utf8");

function freshDb(): { repo: Repo; cleanup: () => void; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), "outreach-test-"));
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  return {
    repo: new Repo(db),
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sampleTarget(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    id: "t_test",
    user_id: "user-a",
    priority: 1,
    path: "A",
    name: "Test Target",
    lab: "Test Lab",
    project: "Test Project",
    fit: "Test fit",
    contact: "test@example.com",
    sentence: "Sentence",
    source: "https://example.com",
    notes: null,
    evidence: null,
    score: 3,
    score_facets: null,
    extracted_at: new Date().toISOString(),
    last_seen_at: null,
    auto: 0,
    category: "research",
    ...overrides,
  };
}

test("repo upsert and list targets", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget());
    const list = repo.listTargets();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "Test Target");
  } finally {
    cleanup();
  }
});

test("opportunity reads and drafts can be scoped to one user", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget({ id: "user-a:shared", user_id: "user-a" }));
    repo.upsertTarget(sampleTarget({ id: "user-b:shared", user_id: "user-b" }));
    assert.deepEqual(repo.listOpportunities("research", "user-a").map(row => row.id), ["user-a:shared"]);
    assert.equal(repo.getTargetForUser("user-b:shared", "user-a"), undefined);
    assert.equal(repo.getTargetForUser("user-a:shared", "user-a")?.user_id, "user-a");
  } finally {
    cleanup();
  }
});

test("repo upsert merges score (takes max)", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget({ score: 5 }));
    repo.upsertTarget(sampleTarget({ score: 2 }));
    const row = repo.getTarget("t_test")!;
    assert.equal(row.score, 5);
  } finally {
    cleanup();
  }
});

test("decision upsert preserves draft when not provided", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget());
    repo.upsertDecision({ target_id: "t_test", status: "approved", checks: null, decided_at: null, draft: "Hello", recipient: "a@b.c" });
    repo.upsertDecision({ target_id: "t_test", status: "sent", checks: null, decided_at: null, draft: null, recipient: null });
    const d = repo.getDecision("t_test")!;
    assert.equal(d.status, "sent");
    assert.equal(d.draft, "Hello");
    assert.equal(d.recipient, "a@b.c");
  } finally {
    cleanup();
  }
});

test("nextPriority increments above max", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget({ id: "t_a", priority: 3 }));
    repo.upsertTarget(sampleTarget({ id: "t_b", priority: 7 }));
    assert.equal(repo.nextPriority(), 8);
  } finally {
    cleanup();
  }
});

test("resequencePriorities makes contiguous 1..N", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget({ id: "t_a", priority: 10 }));
    repo.upsertTarget(sampleTarget({ id: "t_b", priority: 50 }));
    repo.upsertTarget(sampleTarget({ id: "t_c", priority: 99 }));
    repo.resequencePriorities();
    const list = repo.listTargets();
    assert.deepEqual(list.map(t => t.priority), [1, 2, 3]);
  } finally {
    cleanup();
  }
});

test("follow-up create and resolve", () => {
  const { repo, cleanup } = freshDb();
  try {
    repo.upsertTarget(sampleTarget());
    const id = repo.createFollowUp("t_test", "2030-01-01T00:00:00.000Z", "remind me");
    assert.equal(repo.openFollowUps().length, 1);
    repo.resolveFollowUp(id);
    assert.equal(repo.openFollowUps().length, 0);
  } finally {
    cleanup();
  }
});
