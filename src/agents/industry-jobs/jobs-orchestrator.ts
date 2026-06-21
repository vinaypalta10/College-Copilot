/**
 * jobs-orchestrator — the industry-jobs entry point.
 *
 * Flow: job-search-agent finds candidates -> jd-digest-agent extracts structured
 * signal -> job-normalizer-agent produces a NormalizedJob -> score against the
 * student profile -> persist to the `jobs` table (separate from research
 * targets) -> write search memory to Redis when configured. Resume-prompt and
 * networking are pulled on demand from the API, not on every search.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { prefsFromProfile } from "../../scorer/candidates.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";
import { rememberAgentEvent } from "../../memory/agentMemory.ts";
import { stableId } from "../shared/web.ts";
import type { JobRow } from "../../db/repo.ts";
import { findJobs } from "./job-search-agent.ts";
import { digestJob } from "./jd-digest-agent.ts";
import { normalizeJob } from "./job-normalizer-agent.ts";
import type {
  AgentStep,
  JobSearchInput,
  JobSearchOutput,
  NormalizedJob,
  ScoredJob,
} from "./types.ts";

/** Deterministic 0-100 fit score from skill/keyword/query overlap. */
export function scoreJob(
  job: NormalizedJob,
  keywords: string[],
  prefs: StudentPrefs,
  terms: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const interests = (prefs.interests ?? []).map((i) => i.toLowerCase());
  const skills = [...job.requiredSkills, ...job.preferredSkills, ...keywords].map((s) => s.toLowerCase());

  let score = 30; // baseline for a parsed, normalized posting
  const interestHits = interests.filter((i) => skills.some((s) => s.includes(i) || i.includes(s)));
  if (interestHits.length) {
    score += Math.min(40, interestHits.length * 14);
    reasons.push(`Matches your interests: ${interestHits.slice(0, 3).join(", ")}.`);
  }
  const queryHits = terms.filter((t) => `${job.title} ${skills.join(" ")}`.toLowerCase().includes(t));
  if (queryHits.length) {
    score += Math.min(20, queryHits.length * 8);
    reasons.push(`Relevant to "${queryHits.slice(0, 3).join(", ")}".`);
  }
  if (job.employmentType === "internship" || job.employmentType === "new_grad") {
    score += 8;
    reasons.push(`Student-friendly: ${job.employmentType === "internship" ? "internship" : "new-grad role"}.`);
  }
  if (job.requiredSkills.length) reasons.push(`Lists ${job.requiredSkills.length} required skill(s).`);
  if (!reasons.length) reasons.push("Open role from a selected source.");
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

function toRow(job: ScoredJob, userId: string, now: string): JobRow {
  return {
    id: job.id,
    user_id: userId,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    employment_type: job.employmentType,
    source: job.source,
    required_skills: JSON.stringify(job.requiredSkills),
    preferred_skills: JSON.stringify(job.preferredSkills),
    responsibilities: JSON.stringify(job.responsibilities),
    qualifications: JSON.stringify(job.qualifications),
    keywords: JSON.stringify(job.keywords),
    application_deadline: job.applicationDeadline ?? null,
    notes: job.notes ?? null,
    description: job.description,
    score: job.score,
    reasons: JSON.stringify(job.reasons),
    extracted_at: now,
    last_seen_at: now,
  };
}

/** Rebuild the API job shape from a stored row. */
export function rowToScoredJob(row: JobRow): ScoredJob {
  const arr = (s: string): string[] => { try { return JSON.parse(s) as string[]; } catch { return []; } };
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    employmentType: row.employment_type as NormalizedJob["employmentType"],
    source: row.source,
    requiredSkills: arr(row.required_skills),
    preferredSkills: arr(row.preferred_skills),
    responsibilities: arr(row.responsibilities),
    qualifications: arr(row.qualifications),
    ...(row.application_deadline ? { applicationDeadline: row.application_deadline } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    keywords: arr(row.keywords),
    description: row.description ?? "",
    score: row.score,
    reasons: arr(row.reasons),
  };
}

export async function searchJobs(input: JobSearchInput, ctx: AgentContext): Promise<JobSearchOutput> {
  const limit = Math.min(input.limit ?? 12, 30);
  const query = input.query?.trim() ?? "";
  const terms = query.toLowerCase().split(/[^a-z0-9+.#]+/).filter((t) => t.length > 2);
  const prefs = prefsFromProfile(ctx.repo.getProfile(input.userId));
  const now = new Date().toISOString();
  const steps: AgentStep[] = [];

  const search = await findJobs({ query, limit });
  steps.push(...search.steps);

  const scored: ScoredJob[] = [];
  let digestMode: "llm" | "heuristic" = "heuristic";
  for (const candidate of search.candidates.slice(0, limit)) {
    const digest = await digestJob({ title: candidate.title, description: candidate.evidence });
    if (digest.mode === "llm") digestMode = "llm";
    const normalized = normalizeJob({ candidate, digest });
    const { score, reasons } = scoreJob(normalized, digest.keywords, prefs, terms);
    scored.push({
      ...normalized,
      id: stableId("job", candidate.url, candidate.title),
      keywords: digest.keywords,
      description: candidate.evidence,
      score,
      reasons,
    });
  }
  steps.push({ agent: "jd-digest-agent", ok: true, summary: `Digested ${scored.length} posting(s) via ${digestMode} extraction.` });

  // Dedupe by id, rank, persist.
  const byId = new Map<string, ScoredJob>();
  for (const job of scored) {
    const existing = byId.get(job.id);
    if (!existing || job.score > existing.score) byId.set(job.id, job);
  }
  const ranked = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  for (const job of ranked) ctx.repo.upsertJob(toRow(job, input.userId, now));
  steps.push({ agent: "job-normalizer-agent", ok: true, summary: `Normalized and ranked ${ranked.length} job(s) against your profile.` });

  const memory = await rememberAgentEvent({
    userId: input.userId,
    kind: "job-search",
    key: query || "default",
    value: { query, count: ranked.length, sources: [...new Set(ranked.map((j) => j.source))] },
    ttlSec: 60 * 60 * 24 * 7,
  });
  steps.push({
    agent: "agent-memory",
    ok: true,
    summary: memory.backend === "disabled" ? "Redis not configured; SQLite cache only." : `Stored search memory in ${memory.backend}.`,
  });

  return { mode: "live-agent", memory: memory.backend, steps, jobs: ranked };
}

export const jobsOrchestrator: Agent<JobSearchInput, JobSearchOutput> = {
  name: "jobs-orchestrator",
  description: "Industry-jobs entry point: finds openings, digests descriptions, normalizes to NormalizedJob, ranks against the student profile, and caches results. Resume prompts and networking leads are generated on demand.",
  status: "active",
  skills: ["live-source-fetch", "jd-extract", "job-normalize", "job-ranking", "agent-memory"],
  delegatesTo: ["job-search-agent", "jd-digest-agent", "job-normalizer-agent", "resume-prompt-agent", "networking-agent"],
  run: searchJobs,
};

registerAgent(jobsOrchestrator);
