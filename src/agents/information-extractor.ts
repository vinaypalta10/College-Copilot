/**
 * information-extractor — see information-extractor.md for the full design doc.
 *
 * Active (MVP). Given a source URL, fetches the page, scores it against
 * Ruoxi's profile, and returns a structured evidence payload the
 * social-agent can ground its question on.
 *
 * Skills used every run: fetch-page, score-fit.
 *
 * MVP scope: URL only. Topic-search branch and item-level decomposition
 * are still future work — see information-extractor.md for the roadmap.
 */

import { registerAgent } from "./registry.ts";
import type { Agent } from "./types.ts";
import { runSkill } from "../skills/registry.ts";
import { evidenceSnippet } from "../scanner/extractor.ts";
import { profileKeywords } from "../profile/ruoxi.ts";
import type { FetchPageInput, FetchPageOutput } from "../skills/fetch-page.ts";
import type { ScoreFitInput, ScoreFitOutput } from "../skills/score-fit.ts";

export interface InformationExtractorInput {
  source: string;          // URL (topic branch not yet implemented)
  maxItems?: number;       // reserved for future item-level decomposition
  since?: string;          // reserved
  hints?: string[];        // reserved
}

export interface FacetMatch {
  id: string;
  label: string;
  hits: number;
}

export interface ExtractedItem {
  title: string;
  url: string;
  snippet: string;
  kind: "paper" | "repo" | "talk" | "post" | "page";
  date?: string;
  relevance: number;
  facets: FacetMatch[];
}

export interface InformationExtractorOutput {
  summary: string;
  title: string | null;     // page title (used by orchestrator to upgrade placeholder rows)
  items: ExtractedItem[];
  evidence: string;
  detectedEmail: string | null;
  score: number;
  facets: FacetMatch[];     // canonical shape: id + label + hits (matches score_facets in DB)
  reason?: string;          // populated on fetch failure
}

const SKILLS = ["fetch-page", "score-fit"] as const;

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function extractRun(input: InformationExtractorInput, ctx: { repo: import("../db/repo.ts").Repo; targetId?: string }): Promise<InformationExtractorOutput> {
  if (!looksLikeUrl(input.source)) {
    return {
      summary: "Topic-based extraction is not yet implemented in the MVP.",
      title: null,
      items: [],
      evidence: "",
      detectedEmail: null,
      score: 0,
      facets: [],
      reason: `Source is not a URL: "${input.source}". The topic-search branch needs a web-search skill (see information-extractor.md).`,
    };
  }

  const fetched = await runSkill<FetchPageInput, FetchPageOutput>("fetch-page", { url: input.source }, ctx);
  if (!fetched.ok || !fetched.text) {
    return {
      summary: fetched.title ?? "Source page unreachable",
      title: fetched.title ?? null,
      items: [],
      evidence: "",
      detectedEmail: fetched.mailto ?? null,
      score: 0,
      facets: [],
      reason: fetched.reason ?? "fetch-page returned no text",
    };
  }

  const scored = await runSkill<ScoreFitInput, ScoreFitOutput>("score-fit", {
    title: fetched.title ?? "",
    text: fetched.text,
  }, ctx);

  const evidence = evidenceSnippet(fetched.text, profileKeywords());
  const summary = (fetched.text.trim().slice(0, 220) || fetched.title || "").replace(/\s+/g, " ").trim();

  const facets: FacetMatch[] = scored.facets.map(f => ({ id: f.id, label: f.label, hits: f.hits }));

  const item: ExtractedItem = {
    title: fetched.title ?? input.source,
    url: fetched.finalUrl ?? input.source,
    snippet: evidence.slice(0, 240),
    kind: "page",
    relevance: Math.min(1, scored.score / 6),
    facets,
  };

  return {
    summary,
    title: fetched.title ?? null,
    items: [item],
    evidence,
    detectedEmail: fetched.mailto ?? null,
    score: scored.score,
    facets,
  };
}

export const informationExtractor: Agent<InformationExtractorInput, InformationExtractorOutput> = {
  name: "information-extractor",
  description: "Given a source URL, fetches the page and produces a structured evidence payload (summary + evidence snippet + matched profile facets) that the social-agent grounds its question on.",
  status: "active",
  skills: SKILLS,
  run: extractRun,
};

registerAgent(informationExtractor);
