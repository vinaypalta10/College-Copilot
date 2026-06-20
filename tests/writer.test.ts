import { test } from "node:test";
import assert from "node:assert/strict";
import { inferPaperQuestion, localDraft } from "../src/writer/local.ts";
import type { TargetRow } from "../src/db/repo.ts";

function target(over: Partial<TargetRow>): TargetRow {
  return {
    id: "t_test",
    priority: 1,
    path: "A",
    name: "Mert Cemri",
    lab: "Sky/BAIR",
    project: "MAST failure taxonomy",
    fit: "agent failure analysis",
    contact: "mert@example.edu",
    sentence: null,
    source: "https://example.com",
    notes: null,
    evidence: null,
    score: 5,
    score_facets: null,
    extracted_at: null,
    last_seen_at: null,
    auto: 0,
    ...over,
  };
}

test("inferPaperQuestion picks MAST-specific question when project mentions MAST", () => {
  const q = inferPaperQuestion(target({}));
  assert.match(q, /failure modes/);
});

test("inferPaperQuestion falls back to generic design-choice question", () => {
  const q = inferPaperQuestion(target({ project: "some other thing", evidence: null, sentence: null }));
  assert.match(q, /design choice/);
});

test("localDraft includes Subject:, greeting, and signature", () => {
  const draft = localDraft(target({}));
  assert.match(draft, /^Subject: /);
  assert.match(draft, /Hi Mert,/);
  assert.match(draft, /Ruoxi$/);
});

test("localDraft uses first name only", () => {
  const draft = localDraft(target({ name: "Lakshya A. Agrawal" }));
  assert.match(draft, /Hi Lakshya,/);
});
