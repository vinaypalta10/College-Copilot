import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_LABS, searchResearchLabs } from "../src/agents/research-opportunities/lab-opportunities.ts";

test("lab search returns the directory for an empty query", () => {
  assert.equal(searchResearchLabs("").length, RESEARCH_LABS.length);
});

test("lab search filters by research topic", () => {
  const labs = searchResearchLabs("natural language processing");
  assert.equal(labs[0]?.name, "Berkeley NLP");
  assert.ok(labs.every((lab) => /language|nlp/i.test(`${lab.name} ${lab.description} ${lab.topics.join(" ")}`)));
});

test("lab search returns no unrelated matches", () => {
  assert.deepEqual(searchResearchLabs("quantum chemistry"), []);
});
