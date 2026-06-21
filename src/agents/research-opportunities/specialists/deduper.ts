/**
 * research-deduper — merges duplicate labs/programs/people.
 *
 * The same lab or REU often appears under several links or across sources. This
 * agent collapses records that share a normalized URL or a near-identical
 * organization+title, keeping the richest copy (most filled-in fields) and
 * unioning their topics.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { ResearchOpportunity } from "../types.ts";

export interface DeduperInput { opportunities: ResearchOpportunity[] }
export interface DeduperOutput { opportunities: ResearchOpportunity[]; merged: number; summary: string }

function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function normKey(o: ResearchOpportunity): string {
  return `${o.organization} ${o.title}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Count how many optional fields are present — richer records win a merge. */
function richness(o: ResearchOpportunity): number {
  return [o.eligibility, o.deadline, o.contact, o.university, o.location].filter(Boolean).length + o.topics.length;
}

export function dedupe(input: DeduperInput): DeduperOutput {
  const byKey = new Map<string, ResearchOpportunity>();
  let merged = 0;

  for (const opp of input.opportunities) {
    const key = `${normUrl(opp.url)}|${normKey(opp)}`;
    const existing = byKey.get(key) ?? findByUrl(byKey, opp);
    if (!existing) {
      byKey.set(key, { ...opp, topics: [...opp.topics] });
      continue;
    }
    merged++;
    const winner = richness(opp) > richness(existing) ? opp : existing;
    const loser = winner === opp ? existing : opp;
    winner.topics = [...new Set([...winner.topics, ...loser.topics])];
    winner.eligibility ??= loser.eligibility;
    winner.deadline ??= loser.deadline;
    winner.contact ??= loser.contact;
    byKey.set(key, winner);
  }

  return {
    opportunities: [...byKey.values()],
    merged,
    summary: `Deduped to ${byKey.size} unique opportunity(ies) (merged ${merged} duplicate[s]).`,
  };
}

function findByUrl(map: Map<string, ResearchOpportunity>, opp: ResearchOpportunity): ResearchOpportunity | undefined {
  const target = normUrl(opp.url);
  for (const v of map.values()) if (normUrl(v.url) === target) return v;
  return undefined;
}

export const researchDeduper: Agent<DeduperInput, DeduperOutput> = {
  name: "research-deduper",
  description: "Merges duplicate labs/programs/people that appear under multiple links or sources.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(dedupe(input)),
};

registerAgent(researchDeduper);
