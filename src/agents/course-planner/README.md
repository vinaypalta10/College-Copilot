# Course Planner Agent System

Goal: turn a student's academic intent into a small, useful planning context and
a concrete, conflict-free course plan.

The system intentionally has **three agents**. Scoring, requirement matching,
per-course workload evaluation, and context compression are
deterministic functions owned by those agents, not separate agents.

## Architecture

```text
student-query-agent
  -> school-policy-agent
  -> planning-evaluator-agent
```

### 1. Student Query Agent

`student-query-agent.ts` owns:

- Validated natural-language constraint parsing, with a keyless heuristic fallback.
- Saved-profile preference merging.
- Major-transition goals such as "switch to CS."
- Subject, topic, time, professor-rating, workload, open-seat, and course-level
  constraints.
- Deterministic routing between course discovery and school-policy questions.
- A focused follow-up question when the request lacks academic direction.

The optional parser LLM sees only the student's short query, never the catalog.

### 2. School Policy Agent

`school-policy-agent.ts` owns:

- Undergraduate, graduate, or unrestricted course-level policy.
- The student's stated remaining requirements.
- Deterministic requirement-to-course coverage.
- Explicit warnings for major-change eligibility, graduate enrollment, and
  unofficial text-based requirement matching.

It does not invent Berkeley policy or claim to replace an official degree audit.

### 3. Planning Evaluator Agent

`planning-evaluator-agent.ts` owns the remaining scoring and judgement work:

- Catalog/cache retrieval and explainable fit scoring.
- Topic relevance and undergraduate/graduate filtering.
- Bounded concurrent RateMyProfessors enrichment and re-ranking.
- Requirement coverage using the policy agent's scope.
- Per-course workload judgement.
- Context compression.
- Final explanation from compressed context only, with a deterministic fallback.

## API

`POST /api/advisor` returns:

- The three-agent trace.
- Validated constraints and an optional follow-up.
- Policy scope and warnings.
- Ranked courses for discovery queries; policy guidance for policy queries.
- Requirement coverage and uncovered requirements.
- Workload and context-compression metrics.
- A plain-language explanation.

Students add recommended courses to the weekly calendar manually. The calendar
checks conflicts as each course is added; the Copilot never creates a schedule.

## Files

```text
student-query-agent.ts
school-policy-agent.ts
planning-evaluator-agent.ts
advising-orchestrator.ts       thin three-call coordinator; not a registered agent
index.ts                       registers exactly the three agents
```
