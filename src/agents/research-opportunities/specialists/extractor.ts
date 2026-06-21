/**
 * research-extractor — turns messy search hits + read pages into structured
 * ResearchOpportunity records.
 *
 * Deterministic and honest: every record carries an `evidence` snippet from the
 * page (or the index label when the page wasn't read), and inferred fields
 * (type, topics, deadline, contact) are derived from visible text only — never
 * invented. Anything the agent could not find is simply left undefined.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { stableId } from "../../shared/web.ts";
import type { ReadPage } from "./page-reader.ts";
import type { ResearchOpportunity, ResearchOpportunityType, SearchHit } from "../types.ts";

export interface ExtractorInput {
  hits: SearchHit[];
  pages: Map<string, ReadPage>;
  query?: string;
}
export interface ExtractorOutput {
  opportunities: ResearchOpportunity[];
  summary: string;
}

const TOPIC_VOCAB = [
  "machine learning", "deep learning", "nlp", "computer vision", "robotics", "systems",
  "security", "theory", "data science", "bioinformatics", "genomics", "neuroscience",
  "climate", "energy", "materials", "physics", "chemistry", "economics", "hci",
];

function inferType(hit: SearchHit, hay: string): ResearchOpportunityType {
  if (/\breu\b|research experience for undergrad/i.test(hay)) return "reu";
  if (hit.sourceKind === "lab" || /\blab\b|group/i.test(hay)) return "lab";
  if (/professor|faculty|prof\.|dr\./i.test(hay)) return "faculty";
  if (/phd|graduate student|doctoral/i.test(hay)) return "phd_project";
  return "program";
}

function inferTopics(hay: string, query: string): string[] {
  const found = TOPIC_VOCAB.filter((t) => hay.includes(t));
  const queryTopics = query.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 3 && hay.includes(t));
  return [...new Set([...found, ...queryTopics])].slice(0, 6);
}

function findDeadline(text: string): string | undefined {
  const m = text.match(/(?:deadline|due|apply by|applications? (?:due|close))[^.]{0,40}?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return m?.[1]?.trim();
}

function findContact(text: string): string | undefined {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m?.[0];
}

function findEligibility(text: string): string | undefined {
  const m = text.match(/[^.]*\b(?:undergraduate|sophomore|junior|senior|u\.?s\.? citizen|gpa|eligib)[^.]*\./i);
  const s = m?.[0]?.trim();
  return s && s.length <= 200 ? s : undefined;
}

export function extractOpportunities(input: ExtractorInput): ExtractorOutput {
  const query = input.query ?? "";
  const out: ResearchOpportunity[] = [];

  for (const hit of input.hits) {
    const page = input.pages.get(hit.url);
    const evidenceText = page?.text ?? hit.label;
    const hay = `${hit.label} ${hit.url} ${evidenceText}`.toLowerCase();

    out.push({
      id: stableId("research", hit.url, hit.label),
      title: hit.label,
      organization: hit.sourceName,
      url: hit.url,
      opportunityType: inferType(hit, hay),
      topics: inferTopics(hay, query),
      ...(page ? { eligibility: findEligibility(page.text) } : {}),
      ...(page ? { deadline: findDeadline(page.text) } : {}),
      ...(page ? { contact: findContact(page.text) } : {}),
      evidence: evidenceText.slice(0, 500),
      source: hit.sourceName,
    });
  }

  return { opportunities: out, summary: `Extracted ${out.length} structured opportunity record(s).` };
}

export const researchExtractor: Agent<ExtractorInput, ExtractorOutput> = {
  name: "research-extractor",
  description: "Converts search hits and read pages into structured ResearchOpportunity records with honest evidence snippets.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(extractOpportunities(input)),
};

registerAgent(researchExtractor);
