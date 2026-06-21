/**
 * jd-digest-agent — turns a raw job description into structured signal.
 *
 * Extracts requiredSkills, preferredSkills, responsibilities, qualifications,
 * and keywords. Uses the Claude API when an ANTHROPIC_API_KEY is present and
 * falls back to a deterministic keyword/sentence heuristic otherwise, so the
 * pipeline still produces useful digests offline and in tests.
 */

import { z } from "zod";
import { getProvider } from "../../providers/index.ts";
import { log } from "../../lib/log.ts";
import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { JobDigest } from "./types.ts";

/** Common tech / role skills we can detect deterministically in a JD. */
const SKILL_VOCAB = [
  "python", "java", "javascript", "typescript", "c++", "c#", "go", "golang", "rust",
  "scala", "kotlin", "swift", "ruby", "php", "sql", "nosql", "react", "vue", "angular",
  "node", "node.js", "express", "django", "flask", "spring", "graphql", "rest",
  "aws", "azure", "gcp", "kubernetes", "docker", "terraform", "linux", "git",
  "machine learning", "deep learning", "nlp", "computer vision", "llm", "pytorch",
  "tensorflow", "pandas", "numpy", "spark", "hadoop", "kafka", "airflow",
  "data science", "data engineering", "etl", "tableau", "power bi",
  "distributed systems", "microservices", "ci/cd", "agile", "html", "css",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
  "figma", "product management", "ui/ux", "embedded", "firmware", "robotics",
];

const RESPONSIBILITY_CUES = /\b(you will|you'll|responsibilit|in this role|day to day|day-to-day|build|design|develop|implement|collaborate|own|drive|ship|deliver|maintain|partner with)\b/i;
const REQUIRED_CUES = /\b(require|required|must have|minimum qualification|basic qualification|you have|we expect|need to have)\b/i;
const PREFERRED_CUES = /\b(preferred|nice to have|bonus|plus|a plus|desired|ideal|good to have)\b/i;
const QUALIFICATION_CUES = /\b(qualif|degree|bachelor|master|phd|graduat|year(s)? of experience|pursuing|enrolled|gpa|major in)\b/i;

const digestSchema = z.object({
  requiredSkills: z.array(z.string().max(60)).max(20).optional(),
  preferredSkills: z.array(z.string().max(60)).max(20).optional(),
  responsibilities: z.array(z.string().max(200)).max(12).optional(),
  qualifications: z.array(z.string().max(200)).max(12).optional(),
  keywords: z.array(z.string().max(40)).max(20).optional(),
});

const DIGEST_SYSTEM = `You read a single job description and extract structured fields as JSON.
Return ONLY a JSON object with these keys:
  requiredSkills (string[] of concrete hard skills/tools that are required),
  preferredSkills (string[] of skills listed as preferred / nice-to-have / bonus),
  responsibilities (string[] of short phrases describing what the person will do),
  qualifications (string[] of education/experience requirements),
  keywords (string[] of the most important search terms for this role).
Keep each array item short. Omit a key if the description has nothing for it.
Do not invent skills that are not implied by the text.`;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s*[••‣◦⁃∙]\s*|\s*[\n\r]+\s*/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 240);
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(v); }
  }
  return out;
}

/** Deterministic digest used as a fallback and to backfill missing LLM fields. */
export function heuristicDigest(text: string): JobDigest {
  const lower = text.toLowerCase();
  const found = SKILL_VOCAB.filter((skill) => lower.includes(skill));

  const sentences = splitSentences(text);
  const preferredSkills: string[] = [];
  const requiredSkills: string[] = [];
  for (const skill of found) {
    // Attribute a skill to "preferred" only if it co-occurs with a preferred cue.
    const inPreferred = sentences.some((s) => PREFERRED_CUES.test(s) && s.toLowerCase().includes(skill));
    (inPreferred ? preferredSkills : requiredSkills).push(skill);
  }

  const responsibilities = uniq(sentences.filter((s) => RESPONSIBILITY_CUES.test(s))).slice(0, 8);
  const qualifications = uniq(
    sentences.filter((s) => QUALIFICATION_CUES.test(s) || (REQUIRED_CUES.test(s) && !RESPONSIBILITY_CUES.test(s))),
  ).slice(0, 8);

  return {
    requiredSkills: uniq(requiredSkills).slice(0, 12),
    preferredSkills: uniq(preferredSkills).slice(0, 12),
    responsibilities,
    qualifications,
    keywords: uniq(found).slice(0, 12),
  };
}

function mergeDigest(primary: Partial<JobDigest>, fallback: JobDigest): JobDigest {
  const pick = (a: string[] | undefined, b: string[]) => (a && a.length ? uniq(a) : b);
  return {
    requiredSkills: pick(primary.requiredSkills, fallback.requiredSkills),
    preferredSkills: pick(primary.preferredSkills, fallback.preferredSkills),
    responsibilities: pick(primary.responsibilities, fallback.responsibilities),
    qualifications: pick(primary.qualifications, fallback.qualifications),
    keywords: pick(primary.keywords, fallback.keywords),
  };
}

export interface DigestInput { title?: string; description: string }
export interface DigestOutput extends JobDigest { mode: "llm" | "heuristic" }

export async function digestJob(input: DigestInput): Promise<DigestOutput> {
  const fallback = heuristicDigest(`${input.title ?? ""}\n${input.description}`);
  const provider = getProvider();
  if (!provider.available() || input.description.trim().length < 40) {
    return { ...fallback, mode: "heuristic" };
  }
  try {
    const res = await provider.chat({
      system: [{ text: DIGEST_SYSTEM, cache: true }],
      userMessage: `Title: ${input.title ?? "(unknown)"}\n\nDescription:\n${input.description.slice(0, 6000)}`,
      maxTokens: 500,
      temperature: 0,
    });
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return { ...fallback, mode: "heuristic" };
    const parsed = digestSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success) {
      log.warn("jd-digest LLM returned invalid JSON", { issues: parsed.error.issues.length });
      return { ...fallback, mode: "heuristic" };
    }
    return { ...mergeDigest(parsed.data, fallback), mode: "llm" };
  } catch (error) {
    log.warn("jd-digest LLM failed, using heuristic", { error: (error as Error).message });
    return { ...fallback, mode: "heuristic" };
  }
}

interface DigestAgentInput { title?: string; description: string }

export const jdDigestAgent: Agent<DigestAgentInput, DigestOutput> = {
  name: "jd-digest-agent",
  description: "Extracts required/preferred skills, responsibilities, qualifications, and keywords from a job description (Claude when available, deterministic heuristic otherwise).",
  status: "active",
  skills: ["jd-extract"],
  run: async (input: DigestAgentInput, _ctx: AgentContext) => digestJob(input),
};

registerAgent(jdDigestAgent);
