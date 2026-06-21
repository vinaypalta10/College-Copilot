# Agent Systems

College Copilot should have three separate agent systems. Keep them separate:
they solve different problems, need different data, and qualify for different
sponsor stories.

The root of this folder only keeps shared agent infrastructure. Product logic
now lives in one of the three system folders below.

## Target Structure

```text
src/agents/
  course-planner/
    README.md
    index.ts
    advising-orchestrator.ts
    student-query-agent.ts
    school-policy-agent.ts
    planning-evaluator-agent.ts
    # Goal: course planning + Token Company compression story.

  research-opportunities/
    README.md
    # Goal: US-wide research discovery + Fetch.ai multi-agent story.

  industry-jobs/
    README.md
    # Goal: useful job search, JD digestion, resume prompt, networking helper.

  registry.ts
  types.ts
  index.ts
```

## System 1: Course Planner

Primary goal: help a student understand course options and build a realistic
academic plan.

Sponsor angle: The Token Company.

The LLM should do the easiest job:

- parse natural language
- infer goals such as "transfer to CS later"
- produce structured constraints
- explain the course recommendations in plain language

The LLM should not read the whole catalog. Code should retrieve and compress the
context first.

Example:

```text
User: I want to transfer to CS later and keep my schedule light.

Intent parser:
  goal: transfer_to_major
  targetMajor: Computer Science
  workloadTolerance: light

Deterministic tools:
  find major-relevant subjects
  retrieve prerequisite/requirement candidates
  rank courses
  check schedule conflicts
  estimate workload

LLM receives:
  small compressed summary, not the full database
```

## System 2: Research Opportunities

Primary goal: discover research opportunities for undergraduates across the US,
not just Berkeley.

Sponsor angle: Fetch.ai / ASI:One.

This should become the more ambitious multi-agent system:

- source planner
- web/search tool caller
- page reader
- opportunity extractor
- professor/lab/program normalizer
- deduper
- student-fit summarizer
- outreach helper

This system may call external search/pages and should return a trace of what it
searched and what it found. It should not send emails automatically.

## System 3: Industry Jobs

Primary goal: make internship/job search more useful than a list of links.

This is separate from research because jobs have a different workflow and data
model.

Proposed agents:

- `job-search-agent`: finds relevant job openings.
- `job-normalizer-agent`: converts every job into a fixed schema.
- `jd-digest-agent`: extracts skills, responsibilities, and qualifications.
- `resume-prompt-agent`: creates a prompt the student can use with Claude or
  ChatGPT plus their resume.
- `networking-agent`: finds possible LinkedIn/company connections for coffee
  chats. This must remain user-click driven and should not automate outreach.

Minimum job schema:

```ts
interface NormalizedJob {
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
```

## Current Working Code

Current implementation files:

```text
course-planner/advising-orchestrator.ts
  Course planner orchestrator.

course-planner/student-query-agent.ts
  Student intent, profile, constraints, major goals, and follow-ups.

course-planner/school-policy-agent.ts
  Conservative course-level and stated-requirement policy interpretation.

course-planner/planning-evaluator-agent.ts
  Retrieval, scoring, professor evaluation, scheduling, workload, compression,
  and final judgement.

research-opportunities/orchestrator.ts
  Current research opportunity discovery orchestrator.

industry-jobs/orchestrator.ts
  Current industry/job discovery orchestrator.
```

## Design Rules

1. One orchestrator per product workflow.
2. Specialists should have narrow inputs and outputs.
3. Every orchestrator should return a `steps` trace for debugging and demos.
4. Do not give an LLM raw database dumps. Retrieve/compress first.
5. Do not automate external side effects such as sending emails or LinkedIn
   messages.
6. Keep user-visible output honest. If something is a heuristic, say so.
7. Prefer deterministic tools for ranking, filtering, conflicts, and schemas.

## Suggested Next Steps

1. Stabilize `course-planner` first and document the compression path for The
   Token Company.
2. Build the Fetch.ai wrapper around course planning first because it already
   works end-to-end.
3. Expand research discovery into a proper US-wide Fetch.ai workflow.
4. Build the industry job normalizer, JD digest, resume prompt, and networking
   agents inside `industry-jobs/`.
