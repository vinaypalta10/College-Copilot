/**
 * research-opportunities-orchestrator — the planner of the Fetch.ai-style
 * multi-agent research discovery system.
 *
 * Flow (each step is a real specialist agent, recorded in the trace):
 *   research-source-planner  → pick where to look
 *   research-search-agent    → fetch indexes, surface candidate links
 *   research-page-reader     → read the top candidate pages
 *   research-extractor       → structure ResearchOpportunity records
 *   research-deduper         → merge duplicate labs/programs/people
 *   research-summarizer      → explain findings + per-item fit
 *   (outreach-helper runs on demand, per opportunity, never auto-sends)
 *
 * It persists results to the SQLite target cache (so the draft endpoint works)
 * and writes search memory to Redis when configured. The public return shape
 * stays compatible with the opportunities API; the richer ResearchOpportunity
 * records are also returned under `research` for the Fetch.ai adapter.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { TargetRow } from "../../db/repo.ts";
import { rememberAgentEvent } from "../../memory/agentMemory.ts";
import { log } from "../../lib/log.ts";
import { planSources } from "./specialists/source-planner.ts";
import { runSearch } from "./specialists/search-agent.ts";
import { readPages } from "./specialists/page-reader.ts";
import { extractOpportunities } from "./specialists/extractor.ts";
import { dedupe } from "./specialists/deduper.ts";
import { summarize } from "./specialists/summarizer.ts";
import type { ResearchDiscoveryInput, ResearchOpportunity, ResearchStep } from "./types.ts";

/** Back-compat row shape consumed by the opportunities API + frontend. */
export interface ResearchResultRow {
  id: string;
  name: string;
  org: string | null;
  project: string | null;
  fit: string | null;
  contact: string | null;
  source: string | null;
  category: "research";
  evidence: string | null;
  /** Richer fields the new pipeline adds; older clients ignore them. */
  opportunityType: ResearchOpportunity["opportunityType"];
  topics: string[];
  deadline?: string;
  url: string;
}

export interface ResearchOrchestratorOutput {
  mode: "live-agent";
  memory: "redis" | "redis-rest" | "disabled";
  summary: string;
  steps: ResearchStep[];
  opportunities: ResearchResultRow[];
  /** Full structured records for the Fetch.ai / ASI:One adapter. */
  research: ResearchOpportunity[];
}

/** Small matched-term count fed to scoreOpportunity as a relevance signal. */
function relevanceCount(o: ResearchOpportunity, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = `${o.title} ${o.topics.join(" ")} ${o.evidence}`.toLowerCase();
  return terms.filter((t) => hay.includes(t)).length;
}

function toTargetRow(o: ResearchOpportunity, priority: number, score: number): TargetRow {
  const now = new Date().toISOString();
  return {
    id: o.id,
    priority,
    path: "A",
    name: o.title,
    lab: o.organization,
    project: o.topics.join(", ") || o.title,
    fit: o.fit ?? null,
    contact: o.contact ?? o.url,
    sentence: null,
    source: o.url,
    notes: `Discovered by research-opportunities pipeline (${o.opportunityType}).`,
    evidence: o.evidence,
    score,
    score_facets: JSON.stringify({ source: o.source, type: o.opportunityType, topics: o.topics, deadline: o.deadline ?? null }),
    extracted_at: now,
    last_seen_at: now,
    auto: 1,
    category: "research",
  };
}

function toResultRow(o: ResearchOpportunity): ResearchResultRow {
  return {
    id: o.id,
    name: o.title,
    org: o.organization,
    project: o.topics.join(", ") || null,
    fit: o.fit ?? null,
    contact: o.contact ?? o.url,
    source: o.source,
    category: "research",
    evidence: o.evidence,
    opportunityType: o.opportunityType,
    topics: o.topics,
    ...(o.deadline ? { deadline: o.deadline } : {}),
    url: o.url,
  };
}

export async function discoverResearchOpportunities(
  input: ResearchDiscoveryInput,
  ctx: AgentContext,
): Promise<ResearchOrchestratorOutput> {
  const query = input.query?.trim() || "";
  const limit = Math.min(input.limit ?? 12, 30);
  const steps: ResearchStep[] = [];
  const record = (agent: string, ok: boolean, summary: string) => steps.push({ agent, ok, summary });

  // 1. source-planner
  const plan = planSources({ query, interests: input.interests });
  record("research-source-planner", true, plan.summary);

  // 2. search-agent
  const search = await runSearch({ sources: plan.sources, query });
  steps.push(...search.steps);

  // 3. page-reader (bounded)
  const read = await readPages({ hits: search.hits, maxPages: 6 });
  steps.push(...read.steps);

  // 4. extractor
  const extracted = extractOpportunities({ hits: search.hits, pages: read.pages, query });
  record("research-extractor", true, extracted.summary);

  // 5. deduper
  const deduped = dedupe({ opportunities: extracted.opportunities });
  record("research-deduper", true, deduped.summary);

  // 6. summarizer (+ per-item fit) — keep the most query-relevant up to the cap.
  const terms = [...query.toLowerCase().split(/[^a-z0-9+#]+/), ...(input.interests ?? []).map((s) => s.toLowerCase())].filter((t) => t.length > 2);
  const capped = [...deduped.opportunities]
    .sort((a, b) => relevanceCount(b, terms) - relevanceCount(a, terms))
    .slice(0, limit);
  const summarized = await summarize({ opportunities: capped, query, interests: input.interests });
  record("research-summarizer", true, `${summarized.summary} (${summarized.mode})`);

  const opportunities = summarized.opportunities;

  // Persist to the SQLite cache so the draft endpoint can reopen them; the API
  // re-scores via scoreOpportunity, using this relevance count as a signal.
  opportunities.forEach((o, i) => ctx.repo.upsertTarget(toTargetRow(o, i + 1, relevanceCount(o, terms))));
  record("result-cache", true, `Cached ${opportunities.length} opportunity(ies) for drafting and reopening.`);

  // Search memory (Redis when configured).
  const memory = await rememberAgentEvent({
    userId: input.userId,
    kind: "research-opportunity-search",
    key: query || "default",
    value: { query, count: opportunities.length, sources: plan.sources.map((s) => s.url) },
    ttlSec: 60 * 60 * 24 * 7,
  });
  record("agent-memory", true, memory.backend === "disabled" ? "Redis not configured; SQLite cache only." : `Stored search memory in ${memory.backend}.`);

  log.info("research-opportunities-orchestrator complete", { steps: steps.length, count: opportunities.length });

  return {
    mode: "live-agent",
    memory: memory.backend,
    summary: summarized.summary,
    steps,
    opportunities: opportunities.map(toResultRow),
    research: opportunities,
  };
}

export const researchOpportunitiesOrchestrator: Agent<ResearchDiscoveryInput, ResearchOrchestratorOutput> = {
  name: "research-opportunities-orchestrator",
  description: "Plans sources, searches US-wide research indexes, reads pages, extracts + dedupes structured opportunities, and explains findings with a full agent trace. Fetch.ai / ASI:One candidate.",
  status: "active",
  skills: ["live-source-fetch", "agent-memory"],
  delegatesTo: [
    "research-source-planner",
    "research-search-agent",
    "research-page-reader",
    "research-extractor",
    "research-deduper",
    "research-summarizer",
    "outreach-helper",
  ],
  run: discoverResearchOpportunities,
};

registerAgent(researchOpportunitiesOrchestrator);
