/**
 * job-normalizer-agent — converts a raw candidate + digest into a NormalizedJob.
 *
 * This agent owns the *structural* fields of the schema (title, company,
 * location, employmentType, deadline, notes). The skill/responsibility/
 * qualification arrays come from jd-digest-agent and are merged in here so the
 * orchestrator gets one complete NormalizedJob per posting. Deterministic by
 * design — no network — so normalization is cheap and testable.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { JobDigest, NormalizedJob, RawJobCandidate } from "./types.ts";

const US_STATE = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";

/** Classify the role from its title + description text. Order matters. */
export function classifyEmployment(text: string): NormalizedJob["employmentType"] {
  const s = text.toLowerCase();
  if (/\bintern(ship)?\b|\bco-?op\b|\bsummer 20\d\d\b/.test(s)) return "internship";
  if (/\bpart[\s-]?time\b/.test(s)) return "part_time";
  if (/\bnew ?grad\b|\buniversity grad\b|\bearly career\b|\bentry[\s-]?level\b|\bgraduate (engineer|program|scheme|rotational)\b|\bcampus\b|\bclass of 20\d\d\b/.test(s)) {
    return "new_grad";
  }
  return "full_time";
}

/** Best-effort location pull: "Remote", "City, ST", or "City, Country". */
export function extractLocation(text: string): string {
  if (/\bfully remote\b|\bremote[\s-]?first\b|\b100% remote\b/i.test(text)) return "Remote";
  const cityState = text.match(new RegExp(`\\b([A-Z][a-zA-Z.\\-]+(?:\\s[A-Z][a-zA-Z.\\-]+){0,2}),\\s*(?:${US_STATE})\\b`));
  if (cityState) return cityState[0];
  const hub = text.match(/\b(San Francisco|New York|Seattle|Boston|Austin|Los Angeles|Chicago|London|Berlin|Toronto|Bay Area|Mountain View|Palo Alto|Menlo Park|Sunnyvale|Cupertino|Remote)\b/i);
  if (hub) return hub[0];
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  return "Not specified";
}

/** Look for an explicit application deadline; returns ISO date or undefined. */
export function extractDeadline(text: string): string | undefined {
  const cue = /(?:deadline|apply by|applications? (?:close|due)|closes on)[^.\n]{0,40}?\b(\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)/i;
  const m = text.match(cue);
  if (!m || !m[1]) return undefined;
  const iso = m[1].match(/^\d{4}-\d{2}-\d{2}$/);
  if (iso) return m[1];
  const parsed = new Date(m[1]);
  return Number.isNaN(parsed.getTime()) ? m[1] : parsed.toISOString().slice(0, 10);
}

export interface NormalizeInput {
  candidate: RawJobCandidate;
  digest: JobDigest;
}

export function normalizeJob(input: NormalizeInput): NormalizedJob {
  const { candidate, digest } = input;
  const haystack = `${candidate.title}\n${candidate.evidence}`;
  const deadline = extractDeadline(candidate.evidence);
  const noteBits: string[] = [];
  if (digest.keywords.length) noteBits.push(`Focus: ${digest.keywords.slice(0, 5).join(", ")}.`);
  noteBits.push(`Source: ${candidate.source}.`);

  return {
    title: candidate.title.trim().slice(0, 160),
    company: candidate.company.trim() || "Unknown company",
    // Prefer the ATS's structured values; fall back to text heuristics.
    location: candidate.location?.trim() || extractLocation(haystack),
    url: candidate.url,
    employmentType: candidate.employmentType ?? classifyEmployment(haystack),
    source: candidate.source,
    requiredSkills: digest.requiredSkills,
    preferredSkills: digest.preferredSkills,
    responsibilities: digest.responsibilities,
    qualifications: digest.qualifications,
    ...(deadline ? { applicationDeadline: deadline } : {}),
    notes: noteBits.join(" "),
  };
}

export const jobNormalizerAgent: Agent<NormalizeInput, NormalizedJob> = {
  name: "job-normalizer-agent",
  description: "Converts a raw posting plus its digest into a fixed-schema NormalizedJob (title, company, location, employmentType, deadline, skills, responsibilities, qualifications).",
  status: "active",
  skills: ["job-normalize"],
  run: async (input: NormalizeInput, _ctx: AgentContext) => normalizeJob(input),
};

registerAgent(jobNormalizerAgent);
