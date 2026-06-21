# Research Opportunities Agent System

Goal: discover undergraduate research opportunities across the US, not only at
Berkeley.

Sponsor target: Fetch.ai / ASI:One.

## What This System Owns

- Searching for research programs, labs, faculty pages, PhD student project
  pages, REUs, and university research centers.
- Extracting structured opportunity records from messy webpages.
- Deduplicating repeated programs/labs.
- Summarizing why an opportunity may be relevant.
- Helping draft outreach, without sending anything automatically.

## Proposed Agents

```text
research-source-planner
  chooses search targets and source categories

research-search-agent
  performs web/search API calls

research-page-reader
  fetches and cleans pages

research-extractor
  turns pages into structured opportunity records

research-deduper
  merges duplicate labs/programs/people

research-summarizer
  explains what was found and what to inspect next

outreach-helper
  drafts optional outreach text for user review
```

## Minimum Opportunity Schema

```ts
interface ResearchOpportunity {
  title: string;
  organization: string;
  university?: string;
  location?: string;
  url: string;
  opportunityType: "lab" | "reu" | "program" | "faculty" | "phd_project";
  topics: string[];
  eligibility?: string;
  deadline?: string;
  contact?: string;
  evidence: string;
  source: string;
}
```

## Fetch.ai Story

This system is a strong Fetch.ai candidate because it naturally performs:

- intent understanding
- source planning
- multi-step tool use
- web retrieval
- extraction
- deduplication
- user-facing action suggestions

The final Fetch.ai wrapper should expose this through Agentverse / ASI:One.
