/**
 * Natural-language query parsing for the advising orchestrator.
 *
 * Turns a free-text request into structured QueryConstraints (LLM when an
 * ANTHROPIC_API_KEY is present, keyword heuristic otherwise) and merges them
 * onto the student's saved preferences.
 */

import { getProvider } from "../providers/index.ts";
import type { StudentPrefs } from "../scorer/courseScore.ts";
import { log } from "../lib/log.ts";

export interface QueryConstraints {
  subject?: string | null;
  interests?: string[];
  minProfRating?: number | null;
  workloadTolerance?: "light" | "medium" | "heavy" | null;
  earliest?: string | null;
  latest?: string | null;
  daysOff?: string[];
  openOnly?: boolean;
  requirementFocus?: string[];
}

const PARSE_SYSTEM = `You convert a UC Berkeley student's natural-language class-search request into JSON.
Return ONLY a JSON object with any of these keys (omit unknown ones):
  subject (string, dept code like "COMPSCI"), interests (string[]),
  minProfRating (number 0-5), workloadTolerance ("light"|"medium"|"heavy"),
  earliest ("HH:MM"), latest ("HH:MM"), daysOff (string[] of M,Tu,W,Th,F),
  openOnly (boolean), requirementFocus (string[]).
Examples: "mornings" -> latest "12:00". "no friday" -> daysOff ["F"].
"manageable/easy" -> workloadTolerance "light". "nothing below 3.5" -> minProfRating 3.5.`;

export const SUBJECT_ALIASES: Record<string, string> = {
  // Computing, data & math
  cs: "COMPSCI", "computer science": "COMPSCI", eecs: "EECS",
  ee: "ELENG", "electrical engineering": "ELENG",
  data: "DATA", "data science": "DATA", ds: "DATA", datasci: "DATASCI",
  info: "INFO", ischool: "INFO",
  stat: "STAT", statistics: "STAT", stats: "STAT",
  math: "MATH", mathematics: "MATH",
  // Physical sciences & engineering
  physics: "PHYSICS", astronomy: "ASTRON", astro: "ASTRON",
  chem: "CHEM", chemistry: "CHEM",
  "mechanical engineering": "MECENG", meche: "MECENG",
  "civil engineering": "CIVENG",
  "industrial engineering": "INDENG", ieor: "INDENG",
  bioe: "BIOENG", bioengineering: "BIOENG",
  "materials science": "MATSCI",
  "nuclear engineering": "NUCENG",
  // Life & health sciences
  mcb: "MCELLBI", "molecular and cell biology": "MCELLBI",
  ib: "INTEGBI", "integrative biology": "INTEGBI",
  neuro: "NEU", neuroscience: "NEU",
  "public health": "PBHLTH", pbhlth: "PBHLTH",
  nutrition: "NUSCTX",
  // Mind & behavior
  "cognitive science": "COGSCI", cogsci: "COGSCI",
  psych: "PSYCH", psychology: "PSYCH",
  linguistics: "LINGUIS", ling: "LINGUIS",
  // Social sciences
  econ: "ECON", economics: "ECON",
  polisci: "POLSCI", "political science": "POLSCI", "poli sci": "POLSCI",
  sociology: "SOCIOL", socio: "SOCIOL",
  anthro: "ANTHRO", anthropology: "ANTHRO",
  "legal studies": "LEGALST", law: "LEGALST",
  geography: "GEOG", geo: "GEOG",
  "environmental economics": "ENVECON",
  // Humanities & arts
  english: "ENGLISH", history: "HISTORY",
  philosophy: "PHILOS", phil: "PHILOS",
  music: "MUSIC", film: "FILM", art: "ART",
  "comparative literature": "COMLIT", complit: "COMLIT",
  // Business
  haas: "UGBA", business: "UGBA", ugba: "UGBA",
};

export function heuristicParse(q: string): QueryConstraints {
  const s = q.toLowerCase();
  const c: QueryConstraints = {};
  for (const [alias, code] of Object.entries(SUBJECT_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(s)) { c.subject = code; break; }
  }
  if (/\bmorning/.test(s)) c.latest = "12:00";
  if (/\bafternoon/.test(s)) { c.earliest = "12:00"; c.latest = "17:00"; }
  if (/\bevening|night/.test(s)) c.earliest = "17:00";
  if (/manageable|easy|light|chill|low.?workload/.test(s)) c.workloadTolerance = "light";
  if (/hard|heavy|intense|rigorous/.test(s)) c.workloadTolerance = "heavy";
  if (/open|seats|not full/.test(s)) c.openOnly = true;
  const rating = s.match(/(?:above|over|below|at least|minimum|min|no.*below)\s*([0-4](?:\.\d)?)/);
  if (rating?.[1]) c.minProfRating = Number(rating[1]);
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const codes = ["M", "Tu", "W", "Th", "F"];
  const off: string[] = [];
  days.forEach((d, i) => { if (new RegExp(`no ${d}|${d}s?\\s*off|off ${d}`).test(s)) off.push(codes[i]!); });
  if (off.length) c.daysOff = off;
  // requirement focus
  const req = s.match(/(upper[\s-]?div\w*|breadth|elective|requirement|major[\s-]?required?)/);
  if (req?.[1]) c.requirementFocus = [req[1]];
  return c;
}

export async function parseQuery(query: string): Promise<{ constraints: QueryConstraints; mode: "llm" | "heuristic" }> {
  const provider = getProvider();
  if (!provider.available()) return { constraints: heuristicParse(query), mode: "heuristic" };
  try {
    const res = await provider.chat({
      system: [{ text: PARSE_SYSTEM, cache: true }],
      userMessage: query,
      maxTokens: 300,
      temperature: 0,
    });
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return { constraints: heuristicParse(query), mode: "heuristic" };
    const parsed = JSON.parse(match[0]) as QueryConstraints;
    if (parsed.subject) parsed.subject = (SUBJECT_ALIASES[parsed.subject.toLowerCase()] ?? parsed.subject).toUpperCase();
    return { constraints: parsed, mode: "llm" };
  } catch (error) {
    log.warn("advisor LLM parse failed, using heuristic", { error: (error as Error).message });
    return { constraints: heuristicParse(query), mode: "heuristic" };
  }
}

/** Drop case-insensitive duplicates and entries already subsumed by a longer one. */
function dedupeRequirements(reqs: string[]): string[] {
  const cleaned = [...new Set(reqs.map(r => r.trim()).filter(Boolean))];
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return cleaned.filter(r => {
    const cr = canon(r);
    // Drop r if a different, longer entry contains it (after normalizing punctuation).
    return !cleaned.some(other => other !== r && canon(other) !== cr && canon(other).includes(cr));
  });
}

export function mergePrefs(base: StudentPrefs, c: QueryConstraints): StudentPrefs {
  return {
    ...base,
    interests: [...new Set([...(base.interests ?? []), ...(c.interests ?? [])])],
    requirementsRemaining: dedupeRequirements([...(base.requirementsRemaining ?? []), ...(c.requirementFocus ?? [])]),
    minProfRating: c.minProfRating ?? base.minProfRating,
    workloadTolerance: c.workloadTolerance ?? base.workloadTolerance,
    timePrefs: {
      earliest: c.earliest ?? base.timePrefs?.earliest,
      latest: c.latest ?? base.timePrefs?.latest,
      daysOff: c.daysOff?.length ? c.daysOff : base.timePrefs?.daysOff,
    },
  };
}
