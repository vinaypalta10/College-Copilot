import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeepgramTranscript } from "../src/providers/deepgram.ts";

test("parseDeepgramTranscript extracts the top alternative transcript", () => {
  const json = {
    results: { channels: [{ alternatives: [{ transcript: "  find me machine learning classes  ", confidence: 0.99 }] }] },
  };
  assert.equal(parseDeepgramTranscript(json), "find me machine learning classes");
});

test("parseDeepgramTranscript returns empty string on missing/garbage shapes", () => {
  assert.equal(parseDeepgramTranscript({}), "");
  assert.equal(parseDeepgramTranscript(null), "");
  assert.equal(parseDeepgramTranscript({ results: { channels: [] } }), "");
  assert.equal(parseDeepgramTranscript({ results: { channels: [{ alternatives: [{}] }] } }), "");
});
