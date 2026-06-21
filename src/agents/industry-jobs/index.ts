/** Side-effect registration + public surface for the industry-jobs system. */
import "./job-search-agent.ts";
import "./jd-digest-agent.ts";
import "./job-normalizer-agent.ts";
import "./resume-prompt-agent.ts";
import "./networking-agent.ts";
import "./jobs-orchestrator.ts";

export { searchJobs, scoreJob, rowToScoredJob } from "./jobs-orchestrator.ts";
export { digestJob, heuristicDigest } from "./jd-digest-agent.ts";
export { normalizeJob, classifyEmployment, extractLocation, extractDeadline } from "./job-normalizer-agent.ts";
export { buildResumePrompt } from "./resume-prompt-agent.ts";
export { buildNetworkingLeads } from "./networking-agent.ts";
export { findJobs, planJobSources } from "./job-search-agent.ts";
export type {
  NormalizedJob,
  ScoredJob,
  JobSearchInput,
  JobSearchOutput,
  NetworkingResult,
  NetworkingLead,
} from "./types.ts";
