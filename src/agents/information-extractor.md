# information-extractor

| Field | Value |
|---|---|
| Status | **active (MVP)** — URL branch only; topic-search branch and item-level decomposition still future work |
| Skills used every run | `fetch-page`, `score-fit` |
| Sub-agents invoked | — |
| Entry points | `POST /api/agents/information-extractor/run`, called by `orchestrator` |

## Purpose

Given a source (a person's webpage, a paper, a lab page, a job posting, or a free-text topic), surface **related work** that's relevant to Ruoxi's profile: recent papers, code repos, talks, projects in adjacent areas, etc.

This is the *research* agent — it's how the system understands what someone actually does before the `social-agent` writes to them. The output's `evidence` field is what the social-agent grounds its question on.

## Inputs

```ts
{
  source: string;             // URL or topic ("agent failure taxonomies")
  maxItems?: number;          // default 10
  since?: string;             // ISO date — only include items after this
  hints?: string[];           // extra keywords to bias retrieval
}
```

## Outputs

```ts
{
  summary: string;            // 1-2 sentences: what is this person/project about
  items: Array<{
    title: string;
    url: string;
    snippet: string;
    kind: "paper" | "repo" | "talk" | "post" | "page";
    date?: string;
    relevance: number;        // 0-1, scored against profile facets
    facets: string[];         // matched facet ids
  }>;
  evidence: string;           // short text for social-agent grounding
}
```

## Skills it calls

| Skill | Status | Role |
|---|---|---|
| `fetch-page` | active | Pull source URL, extract title + cleaned text + any `mailto:`. |
| `score-fit` | active | Score the extracted text against Ruoxi's profile facets. |

## Skills you'll likely want to add

These don't exist yet — create them in `src/skills/`:

- **`web-search`** — generic search, lets you expand from a name → list of URLs (DuckDuckGo, Brave, Tavily, etc.).
- **`extract-citations`** — pull DOIs / arXiv IDs from a paper page.
- **`find-related-papers`** — given a paper, suggest 3-5 conceptually adjacent ones.
- **`scrape-arxiv`** — given an author, list recent arXiv submissions.
- **`scrape-google-scholar`** — richer citation context (rate-limit carefully).

## Implementation guidance

1. **Branch on input type.**
   - `source` is a URL → call `fetch-page` directly, then `score-fit`, then heuristically slice the page into items (publication lists, project sections, link blocks).
   - `source` is a topic → call `web-search` (once you add it) to get candidate URLs, then loop the above over the top results.

2. **Always populate `evidence`.** It should be a 2-4 sentence concrete excerpt — the social-agent uses it verbatim or paraphrased to ground the question. Empty evidence will result in generic emails.

3. **Score per-item, not just per-page.** The page might be highly relevant overall but contain individual items that aren't. Use `score-fit` on each item's snippet.

4. **De-duplicate against the existing `targets` table.** If an item's URL matches a known target.source, mark it; the orchestrator may skip those.

## When it runs

- Triggered by the `orchestrator` when a new target needs context (`process-new-target` pipeline).
- Could also be triggered manually from the UI later (a "refresh related work" button — not built yet).

## Edge cases to handle

| Case | Suggested handling |
|---|---|
| SPA / JS-heavy page → `fetch-page` returns empty text | Flag in output; orchestrator should escalate to a real headless-browser fetcher. |
| Ambiguous topic ("Pan, agent failures") | Return multiple disambiguation candidates instead of guessing. |
| Source 404 | Return `items: []` + `evidence: ""` + a `summary` like "Source page unreachable"; orchestrator decides whether to retry later. |
| Person has no public page | Caller should fall back to `web-search` or `scrape-arxiv`; don't error here. |

## What lives where

| Concern | Where |
|---|---|
| Agent loop | `src/agents/information-extractor.ts` (this stub) |
| Page fetch + extract | `src/skills/fetch-page.ts` |
| Profile-facet scoring | `src/skills/score-fit.ts` (wraps `src/scorer/`) |
| Profile definition | `src/profile/ruoxi.ts` |
