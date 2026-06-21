/**
 * Shared types for the research-opportunities multi-agent system.
 *
 * Kept separate from the industry-jobs data model on purpose: research and jobs
 * have different shapes, sponsors, and workflows (see ../README.md).
 */

export type ResearchOpportunityType = "lab" | "reu" | "program" | "faculty" | "phd_project";

/** Minimum opportunity schema (see research-opportunities/README.md). */
export interface ResearchOpportunity {
  id: string;
  title: string;
  organization: string;
  university?: string;
  location?: string;
  url: string;
  opportunityType: ResearchOpportunityType;
  topics: string[];
  eligibility?: string;
  deadline?: string;
  contact?: string;
  /** Honest snippet of page text the record was derived from. */
  evidence: string;
  /** Human-readable name of the source it was discovered through. */
  source: string;
  /** Optional one-line fit note added by the summarizer. */
  fit?: string;
}

/** A search target chosen by the source-planner. */
export interface ResearchSource {
  url: string;
  name: string;
  /** Coarse category of the source, used to bias extraction. */
  kind: "program-index" | "lab" | "reu" | "faculty" | "department";
}

/** A candidate link surfaced by the search-agent before pages are read. */
export interface SearchHit {
  url: string;
  label: string;
  sourceName: string;
  sourceKind: ResearchSource["kind"];
}

/** One step in the orchestrator trace (for debugging + sponsor demos). */
export interface ResearchStep {
  agent: string;
  ok: boolean;
  summary: string;
}

export interface ResearchDiscoveryInput {
  userId: string;
  query?: string;
  interests?: string[];
  limit?: number;
}

export interface ResearchDiscoveryOutput {
  mode: "live-agent";
  /** Memory backend that recorded the search (redis | redis-rest | disabled). */
  memory: "redis" | "redis-rest" | "disabled";
  summary: string;
  steps: ResearchStep[];
  opportunities: ResearchOpportunity[];
}
