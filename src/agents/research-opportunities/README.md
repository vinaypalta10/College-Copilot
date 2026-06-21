# Research Lab Opportunities

Goal: help students find Berkeley research labs that match their interests.

## Simple Workflow

```text
student enters a topic
  -> research-source-planner selects the official lab directory
  -> research-search-agent matches names, descriptions, and topics
  -> research-summarizer ranks labs against the student profile
  -> frontend shows compact cards linked to official lab pages
```

The first version intentionally returns labs rather than scraping individual
openings. Lab pages change frequently, so the official page remains the source
of truth for current projects, eligibility, and application instructions.

## Lab Record

Each lab has:

- A stable name and official URL.
- A short description.
- Research topics used for search.
- A profile-aware match score and reason.

Search results are stored per user so they can be reopened safely. Redis records
short-lived search memory when configured. The system never contacts a lab or
sends an email automatically.

## Files

```text
lab-opportunities.ts              typed lab directory + deterministic search
../opportunity-orchestrator.ts    ranking, persistence, and agent trace
../../api/opportunities.ts        authenticated API
```
