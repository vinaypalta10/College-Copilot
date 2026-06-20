import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHtml, pageTitle, extractMailto, evidenceSnippet } from "../src/scanner/extractor.ts";

test("cleanHtml strips scripts, styles, tags, and entities", () => {
  const html = `<html><head><style>body{}</style></head><body><script>x()</script><p>Hello &amp; world</p></body></html>`;
  assert.equal(cleanHtml(html), "Hello & world");
});

test("pageTitle returns the title when present", () => {
  assert.equal(pageTitle("<html><head><title>My Page</title></head></html>", "fallback"), "My Page");
});

test("pageTitle uses fallback when missing", () => {
  assert.equal(pageTitle("<html></html>", "fallback"), "fallback");
});

test("extractMailto finds mailto: link", () => {
  const html = `<a href="mailto:alice@example.com">contact</a>`;
  assert.equal(extractMailto(html), "alice@example.com");
});

test("extractMailto falls back to inline email", () => {
  const html = `<p>Reach me at bob@example.org for details.</p>`;
  assert.equal(extractMailto(html), "bob@example.org");
});

test("extractMailto returns null when no email", () => {
  assert.equal(extractMailto("<p>No email here.</p>"), null);
});

test("evidenceSnippet centers on first keyword match", () => {
  const text = "Some preamble text. We focus on agent evaluation and tool use, with extensive coverage of benchmarks.";
  const snippet = evidenceSnippet(text, ["agent", "evaluation"], 20);
  assert.ok(snippet.includes("agent evaluation"), `snippet should include the keyword: ${snippet}`);
});
