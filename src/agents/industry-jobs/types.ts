/**
 * Shared types for the industry-jobs agent system.
 *
 * Jobs deliberately do NOT reuse the research `TargetRow` model. A posting needs
 * a fixed structured schema (NormalizedJob), a description digest, resume
 * targeting, and networking support — none of which the research opportunity
 * model carries.
 */

/** The fixed schema every posting is normalized into (see README). */
export interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  employmentType: "internship" | "new_grad" | "part_time" | "full_time";
  source: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  applicationDeadline?: string;
  notes?: string;
}

/** A raw posting candidate scraped by job-search-agent, before normalization. */
export interface RawJobCandidate {
  title: string;
  company: string;
  url: string;
  source: string;
  /** Cleaned, tag-stripped text used as the job description for digesting. */
  evidence: string;
  /** Structured location straight from the ATS, preferred over text extraction. */
  location?: string;
  /** Structured employment type from the ATS, preferred over title heuristics. */
  employmentType?: NormalizedJob["employmentType"];
}

/** Structured extraction produced by jd-digest-agent from a description. */
export interface JobDigest {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  keywords: string[];
}

/** A normalized job after digesting, scoring, and persistence — the API shape. */
export interface ScoredJob extends NormalizedJob {
  id: string;
  keywords: string[];
  description: string;
  score: number;
  reasons: string[];
}

export interface JobSearchInput {
  userId: string;
  query?: string;
  limit?: number;
}

export interface AgentStep {
  agent: string;
  ok: boolean;
  summary: string;
}

export interface JobSearchOutput {
  mode: "live-agent";
  memory: "redis" | "redis-rest" | "disabled";
  steps: AgentStep[];
  jobs: ScoredJob[];
}

/** A networking lead — always a manual-click search/link, never an auto-message. */
export interface NetworkingLead {
  type: "recruiter" | "team" | "company" | "alumni";
  label: string;
  /** A pre-built LinkedIn / company search URL the user clicks themselves. */
  searchUrl: string;
}

export interface NetworkingResult {
  job: { id: string; title: string; company: string };
  leads: NetworkingLead[];
  /** Optional draft the user may copy; nothing is sent automatically. */
  connectionNote: string;
  coffeeChatMessage: string;
  safetyNote: string;
}
