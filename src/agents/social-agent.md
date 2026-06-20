# social-agent

| Field | Value |
|---|---|
| Status | **active** |
| Skills used every run | `draft-email`, `critique-draft` |
| Sub-agents invoked | — |
| Entry points | `POST /api/agents/social-agent/run`, indirectly via `POST /api/write-email` |

## Purpose

Drafts a relationship-first cold email for any target. Emphasises *human-feeling* writing: warm, specific, low-pressure, question-first, not over-polished.

This is the agent that runs the **preference-based feedback loop** — the practical "RLHF at the prompt layer":

1. Pull the user's most recent ratings from the `email_ratings` table.
2. Inject top-N thumbs-up drafts as **positive examples**, top-N thumbs-down drafts as **negative examples**, into the system prompt for `draft-email`.
3. Generate a draft via `draft-email`.
4. Critique it via `critique-draft`.
5. If the critic score is below `WRITER_QUALITY_THRESHOLD`, retry `draft-email` once with the critic's structured issues appended as additional constraints.
6. Return the final draft, the critic breakdown, and metadata.

The user then rates the result thumbs-up/down, and those ratings flow back into step 2 on the next call. The dataset keeps growing; the in-context exemplars get sharper; drafts drift toward "your voice" without anyone ever fine-tuning a model.

## Inputs

```ts
{
  target: TargetRow;           // the person/project to write to
  currentDraft?: string;       // optional existing draft to improve
}
```

## Outputs

```ts
{
  draft: string;
  mode: "llm" | "local";       // local = fell back to template (no API key)
  provider?: "anthropic";
  model?: string;
  cacheHit?: boolean;
  critic?: CritiqueDraftOutput;
  iterations: number;          // 1 or 2
  preferenceExamples: { positive: number; negative: number };
  skillsUsed: string[];
}
```

## Why this is "RLHF at the prompt layer"

Real RLHF trains a model on preference data — gradients flow into the weights. We don't have a model to train, and renting one for this scale is overkill.

The practical pattern that delivers most of the win is: **collect preferences, show them in-context as exemplars + anti-exemplars, let the model adapt inside its activation for that one call.** No weights change, but the corpus of exemplars keeps growing, so each call is conditioned on a richer signal than the last.

This is also what enterprise prompt-optimisation pipelines (DSPy, etc.) effectively do under the hood.

## Skills it calls

- **`draft-email`** — pure draft generation. Takes the target, optional current draft, and preference + constraint blocks.
- **`critique-draft`** — scores the draft 1-5 across specificity, warmth, question quality, brevity. Returns structured issues that the agent can pipe back into a retry.

Both skills live in `src/skills/` and are independently callable, so any future agent can compose them differently.

## When it runs

- **User-driven:** clicking *Rewrite with AI* in the detail panel.
- **Programmatic:** `POST /api/agents/social-agent/run`.
- **Future:** invoked by the `orchestrator` when the planned action is "draft an outreach email" (for new targets, replies, or follow-ups).

## Config

| Env var | Default | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key; absent => local-template fallback. |
| `WRITER_QUALITY_THRESHOLD` | 4 | Critic score below which the agent retries `draft-email`. |
| `WRITER_MAX_ITERATIONS` | 2 | Max draft attempts in one run. |

## Implementation notes

- Both skills go through the provider abstraction in `src/providers/` (Claude API).
- If `draft-email` returns `mode: "local"` (no API key set), the agent skips the critique step and returns the local-template draft. Ratings still record so the loop is ready when a key appears.
- Failure modes are explicit: any thrown error from `draft-email` lands as `mode: "local"` with an explanatory `note`. Critic failure breaks the retry loop but still returns the most recent draft.

## What lives where

| Concern | Where |
|---|---|
| Agent loop logic | `src/agents/social-agent.ts` |
| Draft generation skill | `src/skills/draft-email.ts` |
| Critic skill | `src/skills/critique-draft.ts` |
| Prompts + style guide | `src/writer/prompts.ts` |
| Local-template fallback | `src/writer/local.ts` |
| Preference store | `email_ratings` table; reads via `Repo.preferenceExamples()` |
