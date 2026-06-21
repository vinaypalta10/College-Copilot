/**
 * Opportunity fit scoring: ranks research and industry opportunities against a
 * specific student's profile. Pure and explainable.
 */

import type { TargetRow } from "../db/repo.ts";
import type { StudentPrefs } from "./courseScore.ts";

export interface OpportunityFit {
  score: number;
  reasons: string[];
  matched: string[];
}

function tokens(prefs: StudentPrefs): string[] {
  const out = new Set<string>();
  for (const interest of prefs.interests ?? []) out.add(interest.toLowerCase());
  if (prefs.major) {
    out.add(prefs.major.toLowerCase());
    for (const word of prefs.major.toLowerCase().split(/\s+/)) {
      if (word.length > 3) out.add(word);
    }
  }
  return [...out];
}

export function scoreOpportunity(target: TargetRow, prefs: StudentPrefs): OpportunityFit {
  const haystack = [
    target.name,
    target.lab,
    target.project,
    target.fit,
    target.evidence,
  ].filter(Boolean).join(" ").toLowerCase();
  const terms = tokens(prefs);
  const matched = terms.filter(term => haystack.includes(term));

  let score = 40 + Math.min(20, (target.score ?? 0) * 2) + Math.min(30, matched.length * 12);
  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (matched.length) reasons.push(`Matches your profile: ${matched.slice(0, 4).join(", ")}.`);
  if ((target.score ?? 0) >= 3) reasons.push("Strong source relevance from the agent search.");
  if (target.contact) reasons.push("Has a contact to reach out to.");
  if (!reasons.length) reasons.push("General fit - worth a look.");

  return { score, reasons, matched };
}
