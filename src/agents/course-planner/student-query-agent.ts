/**
 * Natural-language query parsing for the advising orchestrator.
 *
 * Turns a free-text request into structured QueryConstraints (LLM when an
 * ANTHROPIC_API_KEY is present, keyword heuristic otherwise) and merges them
 * onto the student's saved preferences.
 */

import { getProvider } from "../../providers/index.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";
import { log } from "../../lib/log.ts";
import { z } from "zod";
import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { prefsFromProfile } from "../../scorer/candidates.ts";

export interface QueryConstraints {
  subject?: string | null;
  targetMajor?: string | null;
  interests?: string[];
  keywords?: string[];
  minProfRating?: number | null;
  workloadTolerance?: "light" | "medium" | "heavy" | null;
  earliest?: string | null;
  latest?: string | null;
  daysOff?: string[];
  openOnly?: boolean;
  requirementFocus?: string[];
  level?: "undergraduate" | "graduate" | "any";
  minCourseNumber?: number | null;
  maxCourseNumber?: number | null;
  allowedDays?: string[];
  topicQuery?: string | null;
}

const constraintsSchema = z.object({
  subject: z.string().max(20).nullable().optional(),
  targetMajor: z.string().max(120).nullable().optional(),
  interests: z.array(z.string().max(80)).max(12).optional(),
  keywords: z.array(z.string().max(80)).max(12).optional(),
  minProfRating: z.number().min(0).max(5).nullable().optional(),
  workloadTolerance: z.enum(["light", "medium", "heavy"]).nullable().optional(),
  earliest: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  latest: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  daysOff: z.array(z.enum(["M", "Tu", "W", "Th", "F"])).max(5).optional(),
  allowedDays: z.array(z.enum(["M", "Tu", "W", "Th", "F"])).max(5).optional(),
  openOnly: z.boolean().optional(),
  requirementFocus: z.array(z.string().max(100)).max(12).optional(),
  level: z.enum(["undergraduate", "graduate", "any"]).optional(),
  minCourseNumber: z.number().int().min(0).max(999).nullable().optional(),
  maxCourseNumber: z.number().int().min(0).max(999).nullable().optional(),
  topicQuery: z.string().max(160).nullable().optional(),
});

const PARSE_SYSTEM = `You convert a UC Berkeley student's natural-language class-search request into JSON.
Return ONLY a JSON object with any of these keys (omit unknown ones):
  subject (string, dept code like "COMPSCI"), targetMajor (string), interests (string[]),
  keywords (string[] of course topics explicitly requested),
  minProfRating (number 0-5), workloadTolerance ("light"|"medium"|"heavy"),
  earliest ("HH:MM"), latest ("HH:MM"), daysOff (string[] of M,Tu,W,Th,F),
  allowedDays (string[] of M,Tu,W,Th,F), openOnly (boolean),
  requirementFocus (string[]), level ("undergraduate"|"graduate"|"any"),
  minCourseNumber (number), maxCourseNumber (number),
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

const MAJOR_BY_SUBJECT: Record<string, string> = {
  COMPSCI: "Computer Science", EECS: "Electrical Engineering & Computer Sciences",
  DATA: "Data Science", STAT: "Statistics", MATH: "Mathematics",
  ECON: "Economics", COGSCI: "Cognitive Science", PSYCH: "Psychology",
};

const TOPICS = [
  "machine learning", "artificial intelligence", "algorithms", "data science",
  "systems", "security", "databases", "theory", "robotics", "natural language",
  "computer vision", "biology", "climate", "finance",
];

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
    if (!new RegExp(`\\b(?:${pattern})\\b`, "i").test(s)) continue;
    mentioned.push(code);
    const negative = new RegExp(
      `(?:\\bno\\b|\\bnot\\s+on\\b|\\bavoid\\b|\\bexcluding?\\b|\\bwithout\\b|\\boff\\b)[^,.]{0,18}\\b(?:${pattern})\\b|\\b(?:${pattern})\\b[^,.]{0,8}\\boff\\b`,
      "i",
    );
    if (negative.test(s)) daysOff.push(code);
  }
  const allowedDays = mentioned.filter(code => !daysOff.includes(code));
  const positiveCue = /\b(?:only|on|meet(?:ing)?|held|classes?\s+on|available)\b/i.test(s);
  return { daysOff, allowedDays: positiveCue || allowedDays.length >= 2 ? allowedDays : [] };
}

function extractTopic(s: string, matchedSubjectAlias: string | null): string | null {
  let topic = s;
  if (matchedSubjectAlias) topic = topic.replace(new RegExp(`\\b${matchedSubjectAlias}\\b`, "gi"), " ");
  topic = topic
    .replace(/\b(?:upper|lower)[\s-]?(?:division|div)\w*\b/gi, " ")
    .replace(/\b(?:graduate|grad)[\s-]?(?:level|courses?)?\b/gi, " ")
    .replace(/\b(?:morning|mornings|afternoon|afternoons|evening|evenings|night|nights)\b/gi, " ")
    .replace(/\b(?:manageable|easy|light|chill|low[\s-]?workload|hard|heavy|intense|rigorous)\b/gi, " ")
    .replace(/\b(?:nothing|no professor|professor|rating|rated|minimum|min|above|over|below|at least)\s*(?:below|above|over|at least)?\s*[0-5](?:\.\d)?\b/gi, " ")
    .replace(/\b(?:open|available)\s+(?:seats?|spots?)\b|\bnot full\b/gi, " ")
    .replace(/\b(?:no|not on|avoid|excluding?|without|off|only|on)\s+(?:mondays?|mon|tuesdays?|tues?|tue|wednesdays?|weds?|wed|thursdays?|thurs?|thu|fridays?|fri)\b/gi, " ")
    .replace(/\b(?:mondays?|mon|tuesdays?|tues?|tue|wednesdays?|weds?|wed|thursdays?|thurs?|thu|fridays?|fri)\b/gi, " ")
    .replace(/\b(?:give|show|find|recommend|need|want|looking|please|me|some|any|for|classes?|courses?|coursework|that|which|are|is|the|a|an|in|of|at|with|and|or|about|open|workload|nothing)\b/gi, " ")
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
  if (/\b(?:transfer|switch|change|move|declare)\b/.test(s) && c.subject) {
    c.targetMajor = MAJOR_BY_SUBJECT[c.subject] ?? c.subject;
  }
  if (/\bmorning/.test(s)) c.latest = "12:00";
  if (/\bafternoon/.test(s)) { c.earliest = "12:00"; c.latest = "17:00"; }
  if (/\bevening|night/.test(s)) c.earliest = "17:00";
  if (/manageable|easy|light|chill|low.?workload/.test(s)) c.workloadTolerance = "light";
  if (/hard|heavy|intense|rigorous/.test(s)) c.workloadTolerance = "heavy";
  if (/open|seats|not full/.test(s)) c.openOnly = true;
  const rating = s.match(/(?:above|over|below|at least|minimum|min|no.*below)\s*([0-5](?:\.\d)?)/);
  if (rating?.[1]) c.minProfRating = Number(rating[1]);
  const days = extractDays(s);
  if (days.daysOff.length) c.daysOff = days.daysOff;
  if (days.allowedDays.length) c.allowedDays = days.allowedDays;
  if (/\bupper[\s-]?(?:division|div)\w*\b/.test(s)) {
    c.minCourseNumber = 100;
    c.maxCourseNumber = 199;
    c.level = "undergraduate";
  } else if (/\blower[\s-]?(?:division|div)\w*\b/.test(s)) {
    c.minCourseNumber = 1;
    c.maxCourseNumber = 99;
    c.level = "undergraduate";
  } else if (/\bgraduate|grad[\s-]?level\b/.test(s)) {
    c.minCourseNumber = 200;
    c.level = "graduate";
  }
  const req = s.match(/(breadth|elective|requirement|major[\s-]?required?)/);
  if (req?.[1]) c.requirementFocus = [req[1]];
  const keywords = TOPICS.filter(topic => s.includes(topic));
  if (keywords.length) c.keywords = keywords;
  if (/\b(?:graduate|grad)\s+(?:class|course)/.test(s)) c.level = "graduate";
  else if (/\bundergrad(?:uate)?\b/.test(s)) c.level = "undergraduate";
  c.topicQuery = extractTopic(s, matchedSubjectAlias);
  if (c.topicQuery && !c.keywords?.length) c.keywords = [c.topicQuery];
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
    const validated = constraintsSchema.safeParse(JSON.parse(match[0]));
    if (!validated.success) {
      log.warn("advisor LLM returned invalid constraints", { issues: validated.error.issues.length });
      return { constraints: heuristicParse(query), mode: "heuristic" };
    }
    const parsed: QueryConstraints = validated.data;
    if (parsed.subject) parsed.subject = (SUBJECT_ALIASES[parsed.subject.toLowerCase()] ?? parsed.subject).toUpperCase();
    const fallback = heuristicParse(query);
    parsed.minCourseNumber ??= fallback.minCourseNumber;
    parsed.maxCourseNumber ??= fallback.maxCourseNumber;
    parsed.allowedDays ??= fallback.allowedDays;
    parsed.daysOff ??= fallback.daysOff;
    parsed.topicQuery ??= fallback.topicQuery;
    parsed.keywords ??= fallback.keywords;
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
    major: c.targetMajor ?? base.major,
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

export function followUpFor(query: string, base: StudentPrefs, constraints: QueryConstraints): string | null {
  if (/\b(?:transfer|switch|change|move|declare)\b/i.test(query) && !constraints.targetMajor) {
    return "Which major are you planning to move into?";
  }
  if (!constraints.subject && !constraints.targetMajor && !constraints.keywords?.length && !constraints.topicQuery && !base.major &&
      !(constraints.requirementFocus?.length || base.requirementsRemaining?.length)) {
    return "Which subject, major, or remaining requirement should I prioritize?";
  }
  return null;
}

export interface StudentQueryInput { userId: string; query: string }
export type QueryIntent = "course_search" | "policy_question";
export interface StudentQueryOutput {
  intent: QueryIntent;
  constraints: QueryConstraints;
  prefs: StudentPrefs;
  followUp: string | null;
  mode: "llm" | "heuristic";
  baseMajor: string | null;
  summary: string;
}

export function classifyIntent(query: string): QueryIntent {
  const text = query.toLowerCase().trim();
  if (/^(can|may)\s+i\s+take\b/.test(text)) return "policy_question";
  if (/^(which|what)\s+(courses?|classes?)\b/.test(text)) return "course_search";
  const explicitCourseSearch = /\b(find|recommend|show|list|browse|search for|looking for)\b.*\b(courses?|classes?)\b|\b(courses?|classes?)\b.*\b(find|recommend|show|list|browse)/.test(text);
  if (explicitCourseSearch) return "course_search";
  const questionForm = /^(can|may|am|is|are|do|does|how|what|which|when|where|why)\b/.test(text);
  const policyTopic = /\b(policy|policies|requirement|prerequisite|prereq|eligible|eligibility|declare|declaration|transfer|graduate|graduation|degree|major|minor|unit limit|academic rule)\b/.test(text);
  return questionForm && policyTopic ? "policy_question" : "course_search";
}

export async function manageStudentQuery(input: StudentQueryInput, ctx: AgentContext): Promise<StudentQueryOutput> {
  const basePrefs = prefsFromProfile(ctx.repo.getProfile(input.userId));
  const intent = classifyIntent(input.query);
  const { constraints, mode } = await parseQuery(input.query);
  const prefs = mergePrefs(basePrefs, constraints);
  const followUp = intent === "course_search" ? followUpFor(input.query, basePrefs, constraints) : null;
  const focus = constraints.targetMajor ?? constraints.subject ?? constraints.topicQuery ?? constraints.keywords?.join(", ") ?? basePrefs.major ?? "unspecified focus";
  return {
    constraints,
    intent,
    prefs,
    followUp,
    mode,
    baseMajor: basePrefs.major ?? null,
    summary: `Classified this as ${intent === "course_search" ? "course discovery" : "a school-policy question"} using ${mode} parsing; academic focus: ${focus}${followUp ? "; clarification requested" : ""}.`,
  };
}

export const studentQueryAgent: Agent<StudentQueryInput, StudentQueryOutput> = {
  name: "student-query-agent",
  description: "Routes course-search versus school-policy intent, understands the student's saved profile and constraints, and asks a focused follow-up when needed.",
  status: "active",
  skills: [],
  run: manageStudentQuery,
};

registerAgent(studentQueryAgent);
