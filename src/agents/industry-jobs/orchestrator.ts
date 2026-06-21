/**
 * industry-jobs-orchestrator — planner for the job-search multi-agent system.
 *
 * Flow (each step is a real specialist, recorded in the trace):
 *   job-search-agent     → select sources, fetch, surface candidate openings
 *   job-normalizer-agent → fixed NormalizedJob schema
 *   jd-digest-agent      → skills / responsibilities / qualifications
 *   (resume-prompt-agent + networking-agent run on demand per job)
 *
 * It persists results to the SQLite cache and writes Redis search memory when
 * configured. The return shape stays compatible with the opportunities API; the
 * full NormalizedJob records are also returned under `jobs`.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { TargetRow } from "../../db/repo.ts";
import { rememberAgentEvent } from "../../memory/agentMemory.ts";
import { log } from "../../lib/log.ts";
import { searchJobs } from "./specialists/job-search-agent.ts";
import { normalizeJobs } from "./specialists/job-normalizer-agent.ts";
import { digestJobs } from "./specialists/jd-digest-agent.ts";
import type { JobSearchInput, JobStep, NormalizedJob } from "./types.ts";

export interface JobResultRow {
  id: string;
  name: string;
  org: string | null;
  project: string | null;
  fit: string | null;
  contact: string | null;
  source: string | null;
  category: "industry";
  evidence: string | null;
  employmentType: NormalizedJob["employmentType"];
  requiredSkills: string[];
  location: string;
  url: string;
}

export interface JobOrchestratorOutput {
  mode: "live-agent";
  memory: "redis" | "redis-rest" | "disabled";
  summary: string;
  steps: JobStep[];
  opportunities: JobResultRow[];
  jobs: NormalizedJob[];
}

function dedupeJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  return jobs.filter((j) => {
    const key = `${j.url}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toTargetRow(j: NormalizedJob, priority: number): TargetRow {
  const now = new Date().toISOString();
  const fit = j.requiredSkills.length ? `Needs: ${j.requiredSkills.slice(0, 5).join(", ")}.` : `${j.employmentType.replace("_", " ")} opening.`;
  return {
    id: j.id,
    priority,
    path: "B",
    name: j.title,
    lab: j.company,
    project: `${j.employmentType.replace("_", " ")} · ${j.location}`,
    fit,
    contact: j.url,
    sentence: null,
    source: j.url,
    notes: `Discovered by industry-jobs pipeline from ${j.source}.`,
    evidence: j.evidence ?? null,
    score: 0,
    score_facets: JSON.stringify({
      source: j.source, employmentType: j.employmentType, location: j.location,
      requiredSkills: j.requiredSkills, preferredSkills: j.preferredSkills,
      responsibilities: j.responsibilities, qualifications: j.qualifications,
      applicationDeadline: j.applicationDeadline ?? null,
    }),
    extracted_at: now,
    last_seen_at: now,
    auto: 1,
    category: "industry",
  };
}

function toResultRow(j: NormalizedJob): JobResultRow {
  return {
    id: j.id,
    name: j.title,
    org: j.company,
    project: `${j.employmentType.replace("_", " ")} · ${j.location}`,
    fit: j.requiredSkills.length ? `Needs: ${j.requiredSkills.slice(0, 5).join(", ")}.` : null,
    contact: j.url,
    source: j.source,
    category: "industry",
    evidence: j.evidence ?? null,
    employmentType: j.employmentType,
    requiredSkills: j.requiredSkills,
    location: j.location,
    url: j.url,
  };
}

export async function discoverIndustryJobs(input: JobSearchInput, ctx: AgentContext): Promise<JobOrchestratorOutput> {
  const query = input.query?.trim() || "";
  const limit = Math.min(input.limit ?? 12, 30);
  const steps: JobStep[] = [];
  const record = (agent: string, ok: boolean, summary: string) => steps.push({ agent, ok, summary });

  // 1. job-search-agent
  const search = await searchJobs({ query });
  steps.push(...search.steps);

  // 2. job-normalizer-agent
  const normalized = normalizeJobs({ hits: search.hits });
  record("job-normalizer-agent", true, normalized.summary);

  const unique = dedupeJobs(normalized.jobs).slice(0, limit);

  // 3. jd-digest-agent
  const digested = await digestJobs({ jobs: unique });
  record("jd-digest-agent", true, digested.summary);

  const jobs = digested.jobs;

  // Persist for the draft endpoint + downstream resume/networking agents.
  jobs.forEach((j, i) => ctx.repo.upsertTarget(toTargetRow(j, i + 1)));
  record("result-cache", true, `Cached ${jobs.length} job(s) for resume prompts and networking.`);

  const memory = await rememberAgentEvent({
    userId: input.userId,
    kind: "industry-job-search",
    key: query || "default",
    value: { query, count: jobs.length },
    ttlSec: 60 * 60 * 24 * 7,
  });
  record("agent-memory", true, memory.backend === "disabled" ? "Redis not configured; SQLite cache only." : `Stored search memory in ${memory.backend}.`);

  const summary = jobs.length
    ? `Found ${jobs.length} opening(s). Open a job to generate a resume-tailoring prompt or networking leads.`
    : "No openings matched — try a broader query or different sources.";

  log.info("industry-jobs-orchestrator complete", { steps: steps.length, count: jobs.length });

  return {
    mode: "live-agent",
    memory: memory.backend,
    summary,
    steps,
    opportunities: jobs.map(toResultRow),
    jobs,
  };
}

export const industryJobsOrchestrator: Agent<JobSearchInput, JobOrchestratorOutput> = {
  name: "industry-jobs-orchestrator",
  description: "Plans job sources, searches them, normalizes each opening into NormalizedJob, and digests skills/responsibilities/qualifications, with a full agent trace.",
  status: "active",
  skills: ["live-source-fetch", "agent-memory"],
  delegatesTo: ["job-search-agent", "job-normalizer-agent", "jd-digest-agent", "resume-prompt-agent", "networking-agent"],
  run: discoverIndustryJobs,
};

registerAgent(industryJobsOrchestrator);
