/**
 * job-normalizer-agent — turns a raw JobHit into a NormalizedJob's structural
 * fields (title, company, location, employmentType, source).
 *
 * Deterministic. Skill/responsibility/qualification extraction is left to the
 * jd-digest-agent so each agent has a narrow job. Anything not visible in the
 * label/URL/page is left at a safe default (e.g. location "Unknown").
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import { stableId } from "../../shared/web.ts";
import type { EmploymentType, JobHit, NormalizedJob } from "../types.ts";

export interface NormalizerInput { hits: JobHit[] }
export interface NormalizerOutput { jobs: NormalizedJob[]; summary: string }

function classifyEmployment(hay: string): EmploymentType {
  if (/\bintern(ship)?\b|co-?op/i.test(hay)) return "internship";
  if (/new ?grad|early career|entry[- ]level|university grad/i.test(hay)) return "new_grad";
  if (/part[- ]time/i.test(hay)) return "part_time";
  return "full_time";
}

function inferCompany(hit: JobHit): string {
  // Source name is usually "<Company> ..." — take the leading words.
  const lead = hit.sourceName.replace(/\b(jobs?|careers?|students?|board|software roles)\b/gi, "").trim();
  return lead || hit.sourceName;
}

function inferLocation(hay: string): string {
  const m = hay.match(/\b(remote|san francisco|sf|new york|nyc|seattle|mountain view|menlo park|palo alto|berkeley|boston|austin|london|hybrid)\b/i);
  if (!m) return "Unknown";
  const v = m[1]!.toLowerCase();
  const map: Record<string, string> = { sf: "San Francisco", nyc: "New York" };
  return map[v] ?? m[1]!.replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanTitle(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function normalizeJobs(input: NormalizerInput): NormalizerOutput {
  const jobs: NormalizedJob[] = input.hits.map((hit) => {
    const hay = `${hit.label} ${hit.url} ${hit.pageText ?? ""}`.toLowerCase();
    return {
      id: stableId("job", hit.url, hit.label),
      title: cleanTitle(hit.label),
      company: inferCompany(hit),
      location: inferLocation(hay),
      url: hit.url,
      employmentType: classifyEmployment(hay),
      source: hit.sourceName,
      requiredSkills: [],
      preferredSkills: [],
      responsibilities: [],
      qualifications: [],
      ...(hit.pageText ? { evidence: hit.pageText.slice(0, 500) } : {}),
    };
  });

  return { jobs, summary: `Normalized ${jobs.length} opening(s) into the fixed job schema.` };
}

export const jobNormalizerAgent: Agent<NormalizerInput, NormalizerOutput> = {
  name: "job-normalizer-agent",
  description: "Converts each raw opening into the fixed NormalizedJob schema (title, company, location, employment type, source).",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(normalizeJobs(input)),
};

registerAgent(jobNormalizerAgent);
