/**
 * job-search-agent — selects job sources, fetches them, and surfaces candidate
 * openings (and reads a bounded number of posting pages for the digester).
 *
 * Deterministic source selection + bounded network fetches. It never invents
 * postings; everything it returns is anchored to a real link it fetched.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { fetchPage, extractLinks } from "../../shared/web.ts";
import type { JobHit, JobSource, JobStep } from "../types.ts";

export interface JobSearchAgentInput {
  query?: string;
  maxPerSource?: number;
  maxPagesRead?: number;
}
export interface JobSearchAgentOutput {
  hits: JobHit[];
  steps: JobStep[];
  summary: string;
}

const BASE_SOURCES: JobSource[] = [
  { url: "https://www.databricks.com/company/careers/students", name: "Databricks Students", kind: "company" },
  { url: "https://www.metacareers.com/jobs", name: "Meta Careers", kind: "company" },
  { url: "https://www.ycombinator.com/jobs", name: "Y Combinator Jobs", kind: "board" },
];

const TOPIC_SOURCES: Array<{ test: RegExp; source: JobSource }> = [
  { test: /startup|yc|founder|early stage/i, source: { url: "https://www.ycombinator.com/jobs/role/software-engineer", name: "YC Software Roles", kind: "startup" } },
  { test: /\bai\b|ml|machine learning|llm|research/i, source: { url: "https://www.anthropic.com/jobs", name: "Anthropic Jobs", kind: "company" } },
];

const JOB_LINK = /intern|engineer|developer|scientist|analyst|new ?grad|early career|software|product|research|design/i;

function planSources(query: string): JobSource[] {
  const sources = [...BASE_SOURCES];
  const seen = new Set(sources.map((s) => s.url));
  for (const { test, source } of TOPIC_SOURCES) {
    if (test.test(query) && !seen.has(source.url)) { sources.push(source); seen.add(source.url); }
  }
  return sources;
}

export async function searchJobs(input: JobSearchAgentInput): Promise<JobSearchAgentOutput> {
  const query = input.query ?? "";
  const terms = query.toLowerCase().split(/[^a-z0-9+.#]+/).filter((t) => t.length > 2);
  const maxPerSource = input.maxPerSource ?? 10;
  const sources = planSources(query);
  const hits: JobHit[] = [];
  const steps: JobStep[] = [];
  const seen = new Set<string>();

  steps.push({ agent: "job-search-agent", ok: true, summary: `Selected ${sources.length} job source(s).` });

  for (const source of sources) {
    const page = await fetchPage(source.url);
    if (!page.ok) {
      steps.push({ agent: "job-search-agent", ok: false, summary: `${source.name}: ${page.error ?? "unreachable"}` });
      continue;
    }
    const links = extractLinks(page.html, source.url);
    let kept = 0;
    for (const link of links) {
      if (kept >= maxPerSource) break;
      const hay = `${link.label} ${link.url}`.toLowerCase();
      const looksLikeJob = /job|career|intern|role|position|opening/i.test(link.url) || JOB_LINK.test(link.label);
      const queryHit = !terms.length || terms.some((t) => hay.includes(t));
      if (!looksLikeJob && !queryHit) continue;
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      hits.push({ url: link.url, label: link.label, sourceName: source.name });
      kept++;
    }
    steps.push({ agent: "job-search-agent", ok: true, summary: `${source.name}: ${kept} candidate opening(s).` });
  }

  // Read a bounded number of posting pages so the digester has real JD text.
  const maxRead = input.maxPagesRead ?? 6;
  let read = 0;
  for (const hit of hits.slice(0, maxRead)) {
    const page = await fetchPage(hit.url);
    if (page.ok && page.text.length > 120) { hit.pageText = page.text; read++; }
  }
  steps.push({ agent: "job-search-agent", ok: true, summary: `Read ${read} posting page(s) for digestion.` });

  return { hits, steps, summary: `Found ${hits.length} candidate opening(s) across ${sources.length} source(s).` };
}

export const jobSearchAgent: Agent<JobSearchAgentInput, JobSearchAgentOutput> = {
  name: "job-search-agent",
  description: "Selects job sources, fetches them, and surfaces candidate openings (reads a bounded set of posting pages).",
  status: "active",
  skills: ["live-source-fetch"],
  run: (input) => searchJobs(input),
};

registerAgent(jobSearchAgent);
