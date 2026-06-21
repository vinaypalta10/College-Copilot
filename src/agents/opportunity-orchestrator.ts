/**
 * opportunity-orchestrator — dynamic opportunity discovery.
 *
 * Flow: plan live sources → fetch pages → extract candidate links/cards →
 * rank against the student's profile → store fetched results as agent memory.
 * There is no static opportunity seed database; SQLite is only a cache so
 * returned items can be reopened or drafted against later.
 */

import { createHash } from "node:crypto";
import { registerAgent } from "./registry.ts";
import type { Agent, AgentContext } from "./types.ts";
import type { TargetRow } from "../db/repo.ts";
import { prefsFromProfile } from "../scorer/candidates.ts";
import { scoreOpportunity } from "../scorer/opportunityScore.ts";
import { rememberAgentEvent } from "../memory/agentMemory.ts";

const USER_AGENT = "CollegeCopilot/0.3 opportunity-discovery";

interface SourcePlan {
  url: string;
  name: string;
  category: "research" | "industry";
  kind: string;
}

export interface OpportunitySearchInput {
  userId: string;
  category: "research" | "industry";
  query?: string;
  limit?: number;
}

export interface OpportunityResult {
  id: string;
  name: string;
  org: string | null;
  project: string | null;
  fit: string | null;
  contact: string | null;
  source: string | null;
  category: string;
  evidence: string | null;
  fitScore: number;
  reasons: string[];
}

export interface OpportunitySearchOutput {
  mode: "live-agent";
  memory: "redis" | "redis-rest" | "disabled";
  steps: Array<{ agent: string; ok: boolean; summary: string }>;
  opportunities: OpportunityResult[];
}

function sourcePlan(category: "research" | "industry", query: string): SourcePlan[] {
  if (category === "research") {
    return [
      { url: "https://research.berkeley.edu/urap/", name: "URAP projects", category, kind: "berkeley" },
      { url: "https://bair.berkeley.edu/students.html", name: "BAIR students page", category, kind: "lab" },
      { url: "https://sky.cs.berkeley.edu/", name: "Sky Computing Lab", category, kind: "lab" },
      { url: "https://nlp.cs.berkeley.edu/", name: "Berkeley NLP", category, kind: "lab" },
    ];
  }

  const startupHeavy = /startup|yc|founder/i.test(query);
  return [
    ...(startupHeavy ? [{ url: "https://www.ycombinator.com/jobs", name: "Y Combinator jobs", category, kind: "startup" } as SourcePlan] : []),
    { url: "https://www.databricks.com/company/careers/students", name: "Databricks students", category, kind: "company" },
    { url: "https://www.anthropic.com/jobs", name: "Anthropic jobs", category, kind: "company" },
    { url: "https://www.metacareers.com/jobs", name: "Meta careers", category, kind: "company" },
    { url: "https://www.ycombinator.com/jobs", name: "Y Combinator jobs", category, kind: "startup" },
  ];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stableId(userId: string, category: string, url: string, title: string): string {
  const hash = createHash("sha1").update(`${userId}:${category}:${url}:${title}`).digest("hex").slice(0, 12);
  return `agent_${hash}`;
}

async function fetchSource(source: SourcePlan): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractCandidates(source: SourcePlan, html: string, query: string, userId: string): TargetRow[] {
  const now = new Date().toISOString();
  const text = stripTags(html);
  const terms = query.toLowerCase().split(/[^a-z0-9+.#]+/).filter((term) => term.length > 2);
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const rows: TargetRow[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(html)) && rows.length < 30) {
    const href = match[1];
    const label = match[2];
    if (!href || !label) continue;
    const url = absolutize(href, source.url);
    const title = stripTags(label);
    if (!url || title.length < 6 || title.length > 160) continue;

    const hay = `${title} ${url}`.toLowerCase();
    const looksRelevant = source.category === "research"
      ? /research|urap|lab|student|undergrad|project|join|apply|position/.test(hay)
      : /intern|student|university|software|engineer|job|career|new grad|startup/.test(hay);
    const queryHit = !terms.length || terms.some((term) => hay.includes(term));
    if (!looksRelevant && !queryHit) continue;

    rows.push({
      id: stableId(userId, source.category, url, title),
      user_id: userId,
      priority: rows.length + 1,
      path: source.category === "industry" ? "B" : "A",
      name: title,
      lab: source.name,
      project: title,
      fit: query ? `Discovered from ${source.name} for "${query}".` : `Discovered from ${source.name}.`,
      contact: url,
      sentence: null,
      source: url,
      notes: "Fetched by opportunity-orchestrator.",
      evidence: text.slice(0, 500),
      score: queryHit ? 6 : 3,
      score_facets: JSON.stringify({ source: source.name, kind: source.kind }),
      extracted_at: now,
      last_seen_at: now,
      auto: 1,
      category: source.category,
    });
  }

  if (!rows.length) {
    rows.push({
      id: stableId(userId, source.category, source.url, source.name),
      user_id: userId,
      priority: 1,
      path: source.category === "industry" ? "B" : "A",
      name: source.name,
      lab: source.name,
      project: query ? `Browse source for ${query}` : "Browse source",
      fit: "The page was reachable, but the agent did not find specific listings in static HTML.",
      contact: source.url,
      sentence: null,
      source: source.url,
      notes: "Fetched by opportunity-orchestrator.",
      evidence: text.slice(0, 500),
      score: 2,
      score_facets: JSON.stringify({ source: source.name, kind: source.kind, fallback: true }),
      extracted_at: now,
      last_seen_at: now,
      auto: 1,
      category: source.category,
    });
  }

  return rows;
}

export async function discoverOpportunities(input: OpportunitySearchInput, ctx: AgentContext): Promise<OpportunitySearchOutput> {
  const limit = Math.min(input.limit ?? 12, 30);
  const query = input.query?.trim() || "";
  const prefs = prefsFromProfile(ctx.repo.getProfile(input.userId));
  const steps: OpportunitySearchOutput["steps"] = [];
  const record = (agent: string, ok: boolean, summary: string) => steps.push({ agent, ok, summary });

  const planned = sourcePlan(input.category, query);
  record("source-planner", true, `Selected ${planned.length} live ${input.category} source(s).`);

  const fetched: TargetRow[] = [];
  for (const source of planned) {
    try {
      const html = await fetchSource(source);
      const candidates = extractCandidates(source, html, query, input.userId);
      fetched.push(...candidates);
      record("opportunity-finder", true, `${source.name}: extracted ${candidates.length} candidate(s).`);
    } catch (e) {
      record("opportunity-finder", false, `${source.name}: ${(e as Error).message}`);
    }
  }

  const seen = new Set<string>();
  const ranked = fetched
    .filter((row) => {
      const key = row.source ?? row.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({ row, fit: scoreOpportunity(row, prefs) }))
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, limit);

  ranked.forEach(({ row }, index) => ctx.repo.upsertTarget({ ...row, priority: index + 1 }));
  record("opportunity-ranker", true, `Ranked ${ranked.length} fetched candidate(s) against the student profile.`);

  const memory = await rememberAgentEvent({
    userId: input.userId,
    kind: `opportunity-search:${input.category}`,
    key: query || "default",
    value: { query, count: ranked.length, sources: planned.map((s) => s.url) },
    ttlSec: 60 * 60 * 24 * 7,
  });
  record("agent-memory", true, memory.backend === "disabled" ? "Redis not configured; SQLite cache only." : `Stored search memory in ${memory.backend}.`);

  return {
    mode: "live-agent",
    memory: memory.backend,
    steps,
    opportunities: ranked.map(({ row, fit }) => ({
      id: row.id,
      name: row.name,
      org: row.lab,
      project: row.project,
      fit: row.fit,
      contact: row.contact,
      source: row.source,
      category: row.category ?? input.category,
      evidence: row.evidence,
      fitScore: fit.score,
      reasons: fit.reasons,
    })),
  };
}

export const opportunityOrchestrator: Agent<OpportunitySearchInput, OpportunitySearchOutput> = {
  name: "opportunity-orchestrator",
  description: "Plans live opportunity sources, fetches pages, extracts candidates, ranks them against a student profile, and writes search memory to Redis when configured.",
  status: "active",
  skills: ["live-source-fetch", "opportunity-ranking", "agent-memory"],
  delegatesTo: ["source-planner", "opportunity-finder", "opportunity-ranker"],
  run: discoverOpportunities,
};

registerAgent(opportunityOrchestrator);
