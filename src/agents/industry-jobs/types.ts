/**
 * Shared types for the industry-jobs multi-agent system.
 *
 * Deliberately separate from the research data model: jobs need structured
 * descriptions, resume targeting, and networking support (see ../README.md).
 */

export type EmploymentType = "internship" | "new_grad" | "part_time" | "full_time";

/** Minimum job schema (see industry-jobs/README.md). */
export interface NormalizedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  employmentType: EmploymentType;
  source: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  applicationDeadline?: string;
  notes?: string;
  /** Honest snippet of the posting text the record was derived from. */
  evidence?: string;
}

/** A job source chosen for the search. */
export interface JobSource {
  url: string;
  name: string;
  kind: "company" | "startup" | "board";
}

/** A raw candidate opening before normalization. */
export interface JobHit {
  url: string;
  label: string;
  sourceName: string;
  /** Cleaned page text, when the posting page was read. */
  pageText?: string;
}

export interface JobStep {
  agent: string;
  ok: boolean;
  summary: string;
}

export interface JobSearchInput {
  userId: string;
  query?: string;
  limit?: number;
}

export interface JobSearchOutput {
  mode: "live-agent";
  memory: "redis" | "redis-rest" | "disabled";
  summary: string;
  steps: JobStep[];
  jobs: NormalizedJob[];
}
