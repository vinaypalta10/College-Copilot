import "./specialists/source-planner.ts";
import "./specialists/search-agent.ts";
import "./specialists/page-reader.ts";
import "./specialists/extractor.ts";
import "./specialists/deduper.ts";
import "./specialists/summarizer.ts";
import "./specialists/outreach-helper.ts";
import "./orchestrator.ts";

export { discoverResearchOpportunities, researchOpportunitiesOrchestrator } from "./orchestrator.ts";
export type { ResearchOrchestratorOutput, ResearchResultRow } from "./orchestrator.ts";
export { draftOutreach } from "./specialists/outreach-helper.ts";
export type * from "./types.ts";
