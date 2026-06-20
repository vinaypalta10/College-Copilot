import { fetchPage } from "./fetcher.ts";
import { extractContent, evidenceSnippet } from "./extractor.ts";
import { scoreWithClaude } from "../scorer/claude.ts";
import { keywordScore } from "../scorer/keyword.ts";
import { profile, profileKeywords } from "../profile/ruoxi.ts";
import { Repo, type TargetRow, type SourceRow } from "../db/repo.ts";
import { log } from "../lib/log.ts";

export interface ScanSeenEntry {
  source: string;
  status: "matched" | "ignored" | "error";
  reason?: string;
  name?: string;
  score?: number;
  error?: string;
}

export interface ScanResult {
  added: number;
  updated: number;
  seen: ScanSeenEntry[];
}

interface ScannerState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  lastAdded: number;
  lastUpdated: number;
  count: number;
  totalSources: number;
  progress: ScanSeenEntry[];
}

export const scannerState: ScannerState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  lastAdded: 0,
  lastUpdated: 0,
  count: 0,
  totalSources: 0,
  progress: [],
};

function stableId(input: string): string {
  let hash = 2166136261;
  for (const ch of input) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `t_${(hash >>> 0).toString(16)}`;
}

function keywordPhrase(text: string): string {
  const lower = text.toLowerCase();
  const hits = profileKeywords().filter(k => lower.includes(k)).slice(0, 4);
  return hits.length ? hits.join(", ") : "agent reliability and evaluation";
}

function buildTargetRow(source: SourceRow, content: { title: string; text: string; mailto: string | null; url: string }, score: number, facets: { id: string; label: string; hits: number }[]): TargetRow {
  const isJobLike = /intern|internship|engineer|summer|apply|career|job/.test(content.text.toLowerCase()) || source.kind === "startup";
  const pathName = source.path || (isJobLike ? "B" : "A");
  const project = content.title
    .replace(/\s*\|\s*Y Combinator.*$/i, "")
    .replace(/\s+-\s+.*Careers.*$/i, "")
    .trim();
  const name = source.kind === "startup" ? source.name.replace(/\s+YC job$/i, "") : source.name;
  const phrase = keywordPhrase(content.text);
  const fit = pathName === "B"
    ? "Auto-detected match for agent/workflow engineering, evaluation, infrastructure, or product internship work."
    : "Auto-detected match for agents, LLM evaluation, benchmarking, ML systems, or workflow automation.";
  const sentence = pathName === "B"
    ? `I was interested in ${name} because the role appears to involve ${phrase}, which connects to my agent evaluation and workflow-systems background.`
    : `I was especially interested in ${project} because it touches ${phrase}, which connects to my BAIR benchmark and Postmortem Memory Agent work.`;
  return {
    id: stableId(`auto:${source.url}`),
    priority: 0,
    path: pathName,
    name,
    lab: source.kind === "startup" ? "Startup / company" : "Research lab / project",
    project,
    fit,
    contact: content.mailto ?? (pathName === "B" || isJobLike ? "Apply via source page" : "Need verify email"),
    sentence,
    source: source.url,
    notes: "Auto-extracted by local scanner; verify source details before approving.",
    evidence: evidenceSnippet(content.text, profileKeywords()),
    score,
    score_facets: facets.length ? JSON.stringify(facets) : null,
    extracted_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    auto: 1,
  };
}

async function processOne(repo: Repo, source: SourceRow): Promise<{ outcome: "added" | "updated" | "ignored" | "error"; entry: ScanSeenEntry }> {
  const fetched = await fetchPage(source.url);
  if (!fetched.ok) {
    return { outcome: "error", entry: { source: source.url, status: "error", error: fetched.reason } };
  }
  const content = extractContent(fetched.html, source.name, fetched.finalUrl);
  const kw = keywordScore(`${content.title} ${content.text}`);
  if (kw.score < 2) {
    return { outcome: "ignored", entry: { source: source.url, status: "ignored", reason: "Low keyword score" } };
  }
  const scored = await scoreWithClaude(content.text, content.title);
  const finalScore = Math.max(kw.score, scored.score);
  const finalFacets = scored.facets.length ? scored.facets : kw.facets;
  const newRow = buildTargetRow(source, content, finalScore, finalFacets);

  const existingBySource = repo.getTargetBySource(source.url);
  if (existingBySource) {
    repo.upsertTarget({
      ...existingBySource,
      evidence: newRow.evidence ?? existingBySource.evidence,
      score: Math.max(existingBySource.score, newRow.score),
      score_facets: newRow.score_facets ?? existingBySource.score_facets,
      last_seen_at: newRow.last_seen_at,
    });
    return { outcome: "updated", entry: { source: source.url, status: "matched", score: newRow.score, name: existingBySource.name } };
  }

  newRow.priority = repo.nextPriority();
  repo.upsertTarget(newRow);
  return { outcome: "added", entry: { source: source.url, status: "matched", score: newRow.score, name: newRow.name } };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runScan(repo: Repo): Promise<ScanResult> {
  if (scannerState.running) {
    return { added: 0, updated: 0, seen: [{ source: "scanner", status: "ignored", reason: "Scan already running" }] };
  }
  scannerState.running = true;
  scannerState.startedAt = new Date().toISOString();
  scannerState.lastError = null;
  scannerState.progress = [];

  const sources = repo.listSources();
  scannerState.totalSources = sources.length;
  const concurrency = Number(process.env.SCAN_CONCURRENCY ?? 4);

  const logId = repo.startScan(scannerState.startedAt);
  let added = 0;
  let updated = 0;
  const seen: ScanSeenEntry[] = [];

  try {
    const results = await pool(sources, concurrency, async source => {
      const r = await processOne(repo, source).catch(error => ({
        outcome: "error" as const,
        entry: { source: source.url, status: "error" as const, error: (error as Error).message },
      }));
      scannerState.progress.push(r.entry);
      return r;
    });

    for (const r of results) {
      seen.push(r.entry);
      if (r.outcome === "added") added++;
      else if (r.outcome === "updated") updated++;
    }

    if (added) repo.resequencePriorities();

    scannerState.lastAdded = added;
    scannerState.lastUpdated = updated;
    scannerState.count++;
    scannerState.finishedAt = new Date().toISOString();
    repo.finishScan(logId, scannerState.finishedAt, added, updated, seen, null);
    log.info("scan complete", { added, updated, sources: sources.length });
    return { added, updated, seen };
  } catch (error) {
    const message = (error as Error).message;
    scannerState.lastError = message;
    scannerState.finishedAt = new Date().toISOString();
    repo.finishScan(logId, scannerState.finishedAt, added, updated, seen, message);
    log.error("scan failed", { error: message });
    throw error;
  } finally {
    scannerState.running = false;
  }
}
