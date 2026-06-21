/**
 * research-page-reader — fetches and cleans a bounded set of candidate pages.
 *
 * The search-agent produced many candidate links; reading every page would be
 * slow and rude. This agent reads only the top N hits, returning cleaned text
 * keyed by URL for the extractor. Failures are recorded, not thrown.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { fetchPage } from "../../shared/web.ts";
import type { SearchHit, ResearchStep } from "../types.ts";

export interface PageReaderInput {
  hits: SearchHit[];
  maxPages?: number;
}
export interface ReadPage {
  url: string;
  text: string;
}
export interface PageReaderOutput {
  pages: Map<string, ReadPage>;
  steps: ResearchStep[];
  summary: string;
}

export async function readPages(input: PageReaderInput): Promise<PageReaderOutput> {
  const maxPages = input.maxPages ?? 6;
  const targets = input.hits.slice(0, maxPages);
  const pages = new Map<string, ReadPage>();
  const steps: ResearchStep[] = [];
  let ok = 0;

  for (const hit of targets) {
    const page = await fetchPage(hit.url);
    if (page.ok && page.text.length > 80) {
      pages.set(hit.url, { url: hit.url, text: page.text });
      ok++;
    } else {
      steps.push({ agent: "research-page-reader", ok: false, summary: `${hit.label}: ${page.error ?? "thin page"}` });
    }
  }

  steps.unshift({ agent: "research-page-reader", ok: true, summary: `Read ${ok}/${targets.length} candidate page(s); the rest use index-level evidence.` });
  return { pages, steps, summary: `Read ${ok} page(s).` };
}

export const researchPageReader: Agent<PageReaderInput, PageReaderOutput> = {
  name: "research-page-reader",
  description: "Fetches and cleans the top candidate research pages, returning readable text for extraction.",
  status: "active",
  skills: ["live-source-fetch"],
  run: (input) => readPages(input),
};

registerAgent(researchPageReader);
