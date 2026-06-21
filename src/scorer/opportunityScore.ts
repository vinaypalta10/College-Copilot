/**
 * Opportunity fit scoring — ranks research/industry opportunities against a
 * specific student's profile (major + interests). Pure and explainable.
 *
 * This scores any opportunity text for any student rather than relying on a
 * fixed legacy profile.
 */

import type { TargetRow } from "../db/repo.ts";
import type { StudentPrefs } from "./courseScore.ts";

export interface OpportunityFit {
  score: number;          // 0-100
  reasons: string[];
  matched: string[];      // which profile terms hit
}

function tokens(prefs: StudentPrefs): string[] {
  const out = new Set<string>();
  for (const i of prefs.interests ?? []) out.add(i.toLowerCase());
  if (prefs.major) {
    // Use whole major + its significant words ("Computer Science" -> "computer", "science").
    out.add(prefs.major.toLowerCase());
    for (const w of prefs.major.toLowerCase().split(/\s+/)) if (w.length > 3) out.add(w);
  }
  return [...out];
}

export function scoreOpportunity(t: TargetRow, prefs: StudentPrefs): OpportunityFit {
  const hay = `${t.name ?? ""} ${t.lab ?? ""} ${t.project ?? ""} ${t.fit ?? ""} ${t.evidence ?? ""}`.toLowerCase();
  const terms = tokens(prefs);
  const matched = terms.filter(term => hay.includes(term));

  // Prior from the curated seed score (0..~10), scaled, plus interest hits.
  let score = 40 + Math.min(20, (t.score ?? 0) * 2) + Math.min(30, matched.length * 12);
  score = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (matched.length) reasons.push(`Matches your profile: ${matched.slice(0, 4).join(", ")}.`);
  if ((t.score ?? 0) >= 3) reasons.push("Strong source relevance from the agent search.");
  if (t.contact) reasons.push("Has a contact to reach out to.");
  if (!reasons.length) reasons.push("General fit — worth a look.");
  return { score, reasons, matched };
}
