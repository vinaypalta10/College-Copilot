# Course Planner Agent System

Goal: turn a student's academic intent into a small, useful course-planning
context and a concrete plan.

Sponsor target: The Token Company.

## What This System Owns

- Natural-language course-planning intent.
- Major/transfer goals such as "I want to transfer to CS later."
- Course retrieval from the catalog/cache.
- Requirement matching.
- Professor enrichment.
- Schedule building.
- Workload estimation.
- Context compression before any LLM call.

## What The LLM Should Do

The LLM should parse and explain. It should not search the whole course catalog
in prompt context.

Good LLM tasks:

- Convert user language to structured constraints.
- Identify ambiguous requests that need a follow-up.
- Explain why a plan fits.

Bad LLM tasks:

- Reading the whole course database.
- Manually checking time conflicts.
- Guessing requirements not present in data.

## Target Pipeline

```text
user query
  -> intent parser
  -> major/goal interpreter
  -> deterministic retrieval
  -> context compressor
  -> course finder
  -> professor evaluator
  -> requirement checker
  -> schedule builder
  -> workload estimator
  -> final explanation
```

## Token Company Story

Show before/after context size:

```text
raw catalog + profile + all requirements: large
compressed candidate context: small
LLM output quality: preserved or improved
```

The core claim: the system manages the algorithm and context so the LLM only
sees the minimum useful planning state.

## Current Code Mapping

```text
index.ts
advising-orchestrator.ts
parseQuery.ts
specialists/course-finder.ts
specialists/professor-evaluator.ts
specialists/requirement-checker.ts
specialists/schedule-builder.ts
specialists/workload-estimator.ts
```
