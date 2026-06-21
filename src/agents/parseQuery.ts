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
  minCourseNumber?: number | null;
  maxCourseNumber?: number | null;
  allowedDays?: string[];
  topicQuery?: string | null;
}

const PARSE_SYSTEM = `You convert a UC Berkeley student's natural-language class-search request into JSON.
Return ONLY a JSON object with any of these keys (omit unknown ones):
  subject (string, dept code like "COMPSCI"), interests (string[]),
  minProfRating (number 0-5), workloadTolerance ("light"|"medium"|"heavy"),
  earliest ("HH:MM"), latest ("HH:MM"), daysOff (string[] of M,Tu,W,Th,F),
  allowedDays (string[] of M,Tu,W,Th,F), openOnly (boolean),
  requirementFocus (string[]), minCourseNumber (number), maxCourseNumber (number),
  topicQuery (the requested academic topic after removing scheduling/level words).
Examples: "mornings" -> latest "12:00". "no friday" -> daysOff ["F"].
"only Monday Wednesday" -> allowedDays ["M","W"].
"upper division" -> minCourseNumber 100, maxCourseNumber 199.
"lower division" -> minCourseNumber 1, maxCourseNumber 99.
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

const DAY_ALIASES: Array<{ pattern: string; code: string }> = [
  { pattern: "mondays?|mon", code: "M" },
  { pattern: "tuesdays?|tues?|tue", code: "Tu" },
  { pattern: "wednesdays?|weds?|wed", code: "W" },
  { pattern: "thursdays?|thurs?|thu", code: "Th" },
  { pattern: "fridays?|fri", code: "F" },
];

function extractDays(s: string): { daysOff: string[]; allowedDays: string[] } {
  const daysOff: string[] = [];
  const mentioned: string[] = [];
  for (const { pattern, code } of DAY_ALIASES) {
    const dayRe = new RegExp(`\\b(?:${pattern})\\b`, "i");
    if (!dayRe.test(s)) continue;
    mentioned.push(code);
    const negative = new RegExp(
      `(?:\\bno\\b|\\bnot\\s+on\\b|\\bavoid\\b|\\bexcluding?\\b|\\bwithout\\b|\\boff\\b)[^,.]{0,18}\\b(?:${pattern})\\b|\\b(?:${pattern})\\b[^,.]{0,8}\\boff\\b`,
      "i",
    );
    if (negative.test(s)) daysOff.push(code);
  }
  const allowedDays = mentioned.filter(code => !daysOff.includes(code));
  const positiveCue = /\b(?:only|on|meet(?:ing)?|held|classes?\s+on|available)\b/i.test(s);
  return {
    daysOff,
    allowedDays: positiveCue || allowedDays.length >= 2 ? allowedDays : [],
  };
}

function extractTopic(s: string, matchedSubjectAlias: string | null): string | null {
  let topic = s;
  if (matchedSubjectAlias) {
    topic = topic.replace(new RegExp(`\\b${matchedSubjectAlias}\\b`, "gi"), " ");
  }
  topic = topic
    .replace(/\b(?:upper|lower)[\s-]?(?:division|div)\w*\b/gi, " ")
    .replace(/\b(?:graduate|grad)[\s-]?(?:level|courses?)?\b/gi, " ")
    .replace(/\b(?:morning|mornings|afternoon|afternoons|evening|evenings|night|nights)\b/gi, " ")
    .replace(/\b(?:manageable|easy|light|chill|low[\s-]?workload|hard|heavy|intense|rigorous)\b/gi, " ")
    .replace(/\b(?:nothing|no professor|professor|rating|rated|minimum|min|above|over|below|at least)\s*(?:below|above|over|at least)?\s*[0-5](?:\.\d)?\b/gi, " ")
    .replace(/\b(?:open|available)\s+(?:seats?|spots?)\b|\bnot full\b/gi, " ")
    .replace(/\b(?:no|not on|avoid|excluding?|without|off|only|on)\s+(?:mondays?|mon|tuesdays?|tues?|tue|wednesdays?|weds?|wed|thursdays?|thurs?|thu|fridays?|fri)\b/gi, " ")
    .replace(/\b(?:mondays?|mon|tuesdays?|tues?|tue|wednesdays?|weds?|wed|thursdays?|thurs?|thu|fridays?|fri)\b/gi, " ")
    .replace(/\b(?:give|show|find|recommend|need|want|looking|please|me|some|any|for|classes?|courses?|coursework|that|which|are|is|the|a|an|in|of|at|with|and|or|workload|nothing)\b/gi, " ")
    .replace(/[,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return topic.length >= 2 ? topic : null;
}

export function heuristicParse(q: string): QueryConstraints {
  const s = q.toLowerCase();
  const c: QueryConstraints = {};
  let matchedSubjectAlias: string | null = null;
  for (const [alias, code] of Object.entries(SUBJECT_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(s)) {
      c.subject = code;
      matchedSubjectAlias = alias;
      break;
    }
  }
  if (/\bmorning/.test(s)) c.latest = "12:00";
  if (/\bafternoon/.test(s)) { c.earliest = "12:00"; c.latest = "17:00"; }
  if (/\bevening|night/.test(s)) c.earliest = "17:00";
  if (/manageable|easy|light|chill|low.?workload/.test(s)) c.workloadTolerance = "light";
  if (/hard|heavy|intense|rigorous/.test(s)) c.workloadTolerance = "heavy";
  if (/open|seats|not full/.test(s)) c.openOnly = true;
  const rating = s.match(/(?:above|over|below|at least|minimum|min|no.*below)\s*([0-4](?:\.\d)?)/);
  if (rating?.[1]) c.minProfRating = Number(rating[1]);
  const days = extractDays(s);
  if (days.daysOff.length) c.daysOff = days.daysOff;
  if (days.allowedDays.length) c.allowedDays = days.allowedDays;
  if (/\bupper[\s-]?(?:division|div)\w*\b/.test(s)) {
    c.minCourseNumber = 100;
    c.maxCourseNumber = 199;
  } else if (/\blower[\s-]?(?:division|div)\w*\b/.test(s)) {
    c.minCourseNumber = 1;
    c.maxCourseNumber = 99;
  } else if (/\bgraduate|grad[\s-]?level\b/.test(s)) {
    c.minCourseNumber = 200;
  }
  const req = s.match(/(breadth|elective|requirement|major[\s-]?required?)/);
  if (req?.[1]) c.requirementFocus = [req[1]];
  c.topicQuery = extractTopic(s, matchedSubjectAlias);
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
    // Deterministic parsing fills omissions and standardizes level/day language,
    // while the LLM remains useful for unusual phrasing and topic extraction.
    const fallback = heuristicParse(query);
    parsed.minCourseNumber ??= fallback.minCourseNumber;
    parsed.maxCourseNumber ??= fallback.maxCourseNumber;
    parsed.allowedDays ??= fallback.allowedDays;
    parsed.daysOff ??= fallback.daysOff;
    parsed.topicQuery ??= fallback.topicQuery;
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
      daysOff: [...new Set([
        ...(base.timePrefs?.daysOff ?? []).filter(day => !(c.allowedDays ?? []).includes(day)),
        ...(c.daysOff ?? []),
      ])],
    },
  };
}
