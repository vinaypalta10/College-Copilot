/**
 * research-search-agent — fetches each planned source index and surfaces the
 * relevant candidate links ("search results") for the page-reader to inspect.
 *
 * This is the multi-step tool-use layer: one network call per source, then
 * deterministic relevance filtering on the anchors found. It does NOT read the
 * individual opportunity pages — that is the page-reader's job.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { fetchPage, extractLinks } from "../../shared/web.ts";
import type { ResearchSource, SearchHit, ResearchStep } from "../types.ts";

export interface SearchAgentInput {
  sources: ResearchSource[];
  query?: string;
  maxPerSource?: number;
}
export interface SearchAgentOutput {
  hits: SearchHit[];
  steps: ResearchStep[];
  summary: string;
}

const RELEVANCE = /research|reu|undergrad|student|lab|faculty|project|summer|program|apply|opportunit|fellowship|intern|scholar/i;

function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9+.#]+/).filter((t) => t.length > 2);
}

export async function runSearch(input: SearchAgentInput): Promise<SearchAgentOutput> {
  const terms = queryTerms(input.query ?? "");
  const maxPerSource = input.maxPerSource ?? 12;
  const hits: SearchHit[] = [];
  const steps: ResearchStep[] = [];
  const seen = new Set<string>();

  for (const source of input.sources) {
    // A specific lab or faculty page IS the opportunity — don't explode its nav
    // into "Publications/Members/…". Index/REU pages are listings, so we expand
    // those into their individual program links.
    if (source.kind === "lab" || source.kind === "faculty") {
      if (!seen.has(source.url)) {
        seen.add(source.url);
        hits.push({ url: source.url, label: source.name, sourceName: source.name, sourceKind: source.kind });
      }
      steps.push({ agent: "research-search-agent", ok: true, summary: `${source.name}: kept as one ${source.kind} opportunity.` });
      continue;
    }

    const page = await fetchPage(source.url);
    if (!page.ok) {
      steps.push({ agent: "research-search-agent", ok: false, summary: `${source.name}: ${page.error ?? "unreachable"}` });
      continue;
    }

    const links = extractLinks(page.html, source.url);
    let kept = 0;
    for (const link of links) {
      if (kept >= maxPerSource) break;
      const hay = `${link.label} ${link.url}`.toLowerCase();
      const relevant = RELEVANCE.test(hay);
      const queryHit = !terms.length || terms.some((t) => hay.includes(t));
      if (!relevant && !queryHit) continue;
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      hits.push({ url: link.url, label: link.label, sourceName: source.name, sourceKind: source.kind });
      kept++;
    }

    // Always keep the source itself as a browsable fallback hit.
    if (kept === 0 && !seen.has(source.url)) {
      seen.add(source.url);
      hits.push({ url: source.url, label: source.name, sourceName: source.name, sourceKind: source.kind });
    }
    steps.push({ agent: "research-search-agent", ok: true, summary: `${source.name}: ${kept} relevant link(s).` });
  }

  return { hits, steps, summary: `Collected ${hits.length} candidate link(s) across ${input.sources.length} source(s).` };
}

export const researchSearchAgent: Agent<SearchAgentInput, SearchAgentOutput> = {
  name: "research-search-agent",
  description: "Fetches each planned research source index and extracts the relevant candidate links to inspect.",
  status: "active",
  skills: ["live-source-fetch"],
  run: (input) => runSearch(input),
};

registerAgent(researchSearchAgent);
