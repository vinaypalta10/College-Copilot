/**
 * research-source-planner — chooses which sources to search.
 *
 * Deterministic: it reads the query/interests and selects a bounded set of
 * US-wide research indexes plus topic-specific labs. No network, no LLM — it
 * just decides *where* to look so the rest of the pipeline stays focused.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { ResearchSource } from "../types.ts";

export interface SourcePlanInput {
  query?: string;
  interests?: string[];
}
export interface SourcePlanOutput {
  sources: ResearchSource[];
  summary: string;
}

/** US-wide indexes that always make sense for undergraduate research. */
const BASE_SOURCES: ResearchSource[] = [
  { url: "https://www.pathwaystoscience.org/Undergrads.aspx", name: "Pathways to Science (REU)", kind: "program-index" },
  { url: "https://www.nsf.gov/funding/initiatives/reu/search", name: "NSF REU Sites", kind: "reu" },
  { url: "https://www.nsfetap.org/", name: "NSF ETAP", kind: "program-index" },
];

/** Topic-triggered labs/programs, added when the query matches. */
const TOPIC_SOURCES: Array<{ test: RegExp; source: ResearchSource }> = [
  { test: /\bai\b|ml|machine learning|deep learning|nlp|language model|llm/i, source: { url: "https://bair.berkeley.edu/students.html", name: "Berkeley AI Research (BAIR)", kind: "lab" } },
  { test: /nlp|language|text|linguistic/i, source: { url: "https://nlp.cs.berkeley.edu/", name: "Berkeley NLP", kind: "lab" } },
  { test: /robot|control|autonomous/i, source: { url: "https://robotics.berkeley.edu/", name: "Berkeley Robotics", kind: "lab" } },
  { test: /bio|genom|neuro|cell|health|medic/i, source: { url: "https://www.pathwaystoscience.org/Disciplines.aspx", name: "Pathways to Science — Biosciences", kind: "program-index" } },
  { test: /climate|environment|energy|sustainab/i, source: { url: "https://www.nsf.gov/geo/", name: "NSF Geosciences", kind: "department" } },
];

export function planSources(input: SourcePlanInput): SourcePlanOutput {
  const haystack = `${input.query ?? ""} ${(input.interests ?? []).join(" ")}`.toLowerCase();
  const sources: ResearchSource[] = [...BASE_SOURCES];
  const seen = new Set(sources.map((s) => s.url));

  for (const { test, source } of TOPIC_SOURCES) {
    if (test.test(haystack) && !seen.has(source.url)) {
      sources.push(source);
      seen.add(source.url);
    }
  }

  const topical = sources.length - BASE_SOURCES.length;
  return {
    sources,
    summary: `Selected ${sources.length} research source(s) (${BASE_SOURCES.length} US-wide index + ${topical} topic-specific) for "${input.query || "general"}".`,
  };
}

export const researchSourcePlanner: Agent<SourcePlanInput, SourcePlanOutput> = {
  name: "research-source-planner",
  description: "Chooses which US-wide research indexes and topic-specific labs to search based on the student's query and interests.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(planSources(input)),
};

registerAgent(researchSourcePlanner);
