/**
 * jd-digest-agent — extracts skills, responsibilities, and qualifications from
 * a job's description text and fills those fields on the NormalizedJob.
 *
 * Uses the LLM when available (it only sees the JD text it was given, not a
 * database) and falls back to a transparent keyword/section heuristic otherwise.
 * Jobs whose page text we never fetched are passed through unchanged.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { getProvider } from "../../../providers/index.ts";
import { log } from "../../../lib/log.ts";
import type { NormalizedJob } from "../types.ts";

export interface DigestInput { jobs: NormalizedJob[] }
export interface DigestOutput { jobs: NormalizedJob[]; digested: number; mode: "llm" | "heuristic" | "mixed"; summary: string }

const SKILL_VOCAB = [
  "python", "java", "javascript", "typescript", "c++", "go", "rust", "sql", "react",
  "node", "kubernetes", "docker", "aws", "gcp", "pytorch", "tensorflow", "spark",
  "machine learning", "deep learning", "nlp", "distributed systems", "data structures",
  "algorithms", "git", "linux", "scala", "ruby", "swift", "kotlin",
];

function sentencesAfter(text: string, headerRe: RegExp, max = 5): string[] {
  const idx = text.search(headerRe);
  if (idx < 0) return [];
  const chunk = text.slice(idx, idx + 600);
  return chunk
    .split(/(?:[.•·•]|(?:\s-\s))/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 12 && s.length < 160)
    .slice(1, max + 1);
}

function heuristicDigest(job: NormalizedJob): NormalizedJob {
  const text = (job.evidence ?? "").toLowerCase();
  if (!text) return job;
  const skills = SKILL_VOCAB.filter((s) => text.includes(s));
  const required = skills.filter((s) => new RegExp(`(require|must have|proficien)[^.]{0,80}${s.replace(/[+]/g, "\\+")}`).test(text));
  const preferred = skills.filter((s) => !required.includes(s));
  return {
    ...job,
    requiredSkills: required.length ? required : skills.slice(0, Math.ceil(skills.length / 2)),
    preferredSkills: preferred,
    responsibilities: sentencesAfter(job.evidence ?? "", /responsib|you will|what you'll do|role/i),
    qualifications: sentencesAfter(job.evidence ?? "", /qualif|requirement|minimum|basic|you have|we're looking/i),
  };
}

const SYSTEM = `You read one job description and extract structured fields. Return ONLY JSON:
{"requiredSkills":[],"preferredSkills":[],"responsibilities":[],"qualifications":[]}
Use short phrases. requiredSkills = must-haves; preferredSkills = nice-to-haves. Max 8 items per list. Use only what the text states; do not invent.`;

async function llmDigest(job: NormalizedJob): Promise<NormalizedJob | null> {
  const provider = getProvider();
  if (!provider.available() || !job.evidence) return null;
  try {
    const res = await provider.chat({
      system: [{ text: SYSTEM, cache: true }],
      userMessage: `Title: ${job.title}\nCompany: ${job.company}\nDescription:\n${job.evidence.slice(0, 1800)}`,
      maxTokens: 500,
      temperature: 0,
      model: provider.defaultScorerModel,
    });
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]) as Partial<NormalizedJob>;
    return {
      ...job,
      requiredSkills: arr(p.requiredSkills),
      preferredSkills: arr(p.preferredSkills),
      responsibilities: arr(p.responsibilities),
      qualifications: arr(p.qualifications),
    };
  } catch (e) {
    log.warn("jd-digest LLM failed, using heuristic", { error: (e as Error).message });
    return null;
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
}

export async function digestJobs(input: DigestInput): Promise<DigestOutput> {
  let llmUsed = false;
  let heuristicUsed = false;
  const jobs: NormalizedJob[] = [];

  for (const job of input.jobs) {
    if (!job.evidence) { jobs.push(job); continue; }
    const viaLlm = await llmDigest(job);
    if (viaLlm) { llmUsed = true; jobs.push(viaLlm); }
    else { heuristicUsed = true; jobs.push(heuristicDigest(job)); }
  }

  const digested = jobs.filter((j) => j.requiredSkills.length || j.responsibilities.length || j.qualifications.length).length;
  const mode: DigestOutput["mode"] = llmUsed && heuristicUsed ? "mixed" : llmUsed ? "llm" : "heuristic";
  return { jobs, digested, mode, summary: `Digested ${digested}/${jobs.length} job description(s) (${mode}).` };
}

export const jdDigestAgent: Agent<DigestInput, DigestOutput> = {
  name: "jd-digest-agent",
  description: "Extracts required/preferred skills, responsibilities, and qualifications from each job description (LLM when available, else heuristic).",
  status: "active",
  skills: [],
  run: (input) => digestJobs(input),
};

registerAgent(jdDigestAgent);
