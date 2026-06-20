/**
 * quickAdd — minimal, fast placeholder insert.
 *
 * Does NOT fetch the page or call an LLM. Just validates the URL and writes
 * a placeholder target row with hostname-derived defaults. The orchestrator's
 * process-new-target pipeline (information-extractor → social-agent) then
 * enriches the row with real title, name, evidence, score, contact email,
 * and an initial draft.
 *
 * Why split this way: the orchestrator already fetches + scores + drafts.
 * Doing it again here would double the HTTP fetch and double the LLM
 * scoring call on every paste.
 */

import { Repo, type TargetRow } from "../db/repo.ts";

export interface QuickAddResult {
  ok: true;
  target: TargetRow;
  created: boolean;
}

export interface QuickAddFailure {
  ok: false;
  reason: string;
}

function stableId(input: string): string {
  let hash = 2166136261;
  for (const ch of input) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `t_${(hash >>> 0).toString(16)}`;
}

export async function quickAddFromUrl(repo: Repo, url: string, opts: { hint?: string } = {}): Promise<QuickAddResult | QuickAddFailure> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { ok: false, reason: "Only http(s) URLs are supported" };
  }

  const existing = repo.getTargetBySource(parsedUrl.toString());
  if (existing) {
    return { ok: true, target: existing, created: false };
  }

  const host = parsedUrl.hostname.replace(/^www\./, "");
  const placeholder = opts.hint || host;

  const row: TargetRow = {
    id: stableId(`manual:${parsedUrl.toString()}`),
    priority: repo.nextPriority(),
    path: "A",                              // default; orchestrator will not change this (path is user's domain knowledge)
    name: placeholder,
    lab: host,
    project: "(extracting…)",
    fit: "(extracting…)",
    contact: null,
    sentence: null,
    source: parsedUrl.toString(),
    notes: "Quick-added; the orchestrator will fill in real content.",
    evidence: null,
    score: 0,
    score_facets: null,
    extracted_at: new Date().toISOString(),
    last_seen_at: null,
    auto: 1,
  };
  repo.upsertTarget(row);
  return { ok: true, target: row, created: true };
}
