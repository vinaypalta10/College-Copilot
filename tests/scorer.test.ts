import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordScore } from "../src/scorer/keyword.ts";

test("keywordScore returns 0 for unrelated text", () => {
  const result = keywordScore("This is a baking recipe with flour and sugar.");
  assert.equal(result.score, 0);
  assert.deepEqual(result.facets, []);
});

test("keywordScore picks up agent-eval facet", () => {
  const result = keywordScore("We are building an evaluation benchmark for LLM agents and their trajectories.");
  assert.ok(result.score > 0, "should score above 0");
  assert.ok(result.facets.some(f => f.id === "agent-eval"), "should hit agent-eval");
});

test("keywordScore is case-insensitive", () => {
  const a = keywordScore("Tool Use and Function Calling reliability.");
  const b = keywordScore("tool use and function calling reliability.");
  assert.equal(a.score, b.score);
});

test("keywordScore aggregates across multiple facets", () => {
  const result = keywordScore("We focus on memory, retrieval, and benchmark evaluation for agents.");
  const ids = new Set(result.facets.map(f => f.id));
  assert.ok(ids.has("memory-retrieval"));
  assert.ok(ids.has("agent-eval"));
});
