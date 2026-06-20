# orchestrator

| Field | Value |
|---|---|
| Status | **active (MVP)** — `process-new-target` implemented; `process-reply` and `trigger-followup` still placeholders |
| Skills used every run | (none directly today — owns no atomic tools) |
| Sub-agents invoked | `information-extractor`, `social-agent` |
| Entry points | `POST /api/agents/orchestrator/run`, plus cron-triggered for follow-ups (planned) |

## Purpose

Top-level controller. The orchestrator receives a high-level task ("process this new target", "handle this reply", "trigger follow-ups for stale sends") and decides which sub-agents to invoke and in what order.

The motivation for this layer: individual agents are good at one thing. Real workflows chain them. Centralising the pipeline here means the rest of the system stays simple, and the chain stays visible in one file.

## Inputs

```ts
{
  task: "process-new-target" | "process-reply" | "trigger-followup";
  context: {
    targetId?: string;
    replyBody?: string;
    daysSinceSent?: number;
  };
}
```

## Outputs

```ts
{
  plan: Array<{ agent: string; input: unknown }>;        // what it decided to run
  results: Array<{ agent: string; output: unknown; ok: boolean; error?: string }>;
}
```

## Default pipelines

### `process-new-target`

When a new target is added (manually via Quick-add, or auto-extracted by a scan):

1. `information-extractor` on the target's `source` URL → produces related-work items + evidence snippet.
2. Persist the new evidence + items onto the target row (extend the schema with an `extracted_items` table if you want them queryable).
3. `social-agent` to draft an initial email → store as the default draft for the target.

### `process-reply`

When a recipient replies to one of your outreach emails:

1. `reply-classifier` (skill — currently stub) → `yes` / `no` / `maybe` / `more-info`.
2. If `yes` / `maybe` → `social-agent` with reply context → drafts a scheduling response.
3. If `more-info` → `social-agent` → drafts a short clarifying message.
4. If `no` → no-op; update target status to `replied`.

### `trigger-followup`

Triggered by a scheduled job that checks the `follow_ups` table for due items:

1. `social-agent` (followup mode) → produces a softer re-surface email with a new angle (different question, new artifact, lighter ask).

## Skills you'll likely want to add

These would be owned by the orchestrator itself (vs. delegated to a sub-agent):

| Skill | Why it helps |
|---|---|
| `plan-steps` | Given task + recent state, return an ordered list of agent invocations. Lets you LLM-drive the planner later. |
| `summarize-state` | Collapse a target's history into one paragraph so each sub-agent gets shared context without inflating the prompt. |
| `route-task` | Map a task string to the right pipeline (vs. hard-coding `if/else`). |

Once those exist, replace `SKILLS = []` in `orchestrator.ts` with their names so they show up in the UI's "Skills used every run" list.

## Implementation guidance

1. **Start by hard-coding the three pipelines** above. Don't reach for an LLM-driven planner until you have evidence the rules-based router is the bottleneck.
2. **Log every plan + result** to the existing `skill_runs` table (extend the schema to add an `agent_runs` table if you want them queryable separately).
3. **Idempotency.** Each sub-agent call should be safe to retry. The orchestrator should record the last completed step so a re-run picks up where it left off.
4. **Failure handling.** If a sub-agent fails, the orchestrator should return partial results (whatever did complete) rather than aborting silently. Mark the failed step's `ok: false` and include the error.

## When it runs

| Trigger | Task |
|---|---|
| Scan finishes adding new targets | `process-new-target` for each new target |
| User pastes a URL into Quick-add | `process-new-target` immediately after the add |
| Inbound reply arrives (Gmail watcher / paste) | `process-reply` |
| Follow-up due date hits | `trigger-followup` |

## Why it's a stub

The current direct flow (UI → `social-agent`) works for the single-user case today. The orchestrator becomes valuable as soon as you add the reply pipeline and the follow-up automation, because those need state-aware routing decisions.

When you implement, the right next step is `process-new-target` — it's the most common task and unblocks the *whole* "user pastes URL → has a credible draft within seconds" experience.

## What lives where

| Concern | Where |
|---|---|
| Orchestrator loop | `src/agents/orchestrator.ts` (this stub) |
| Information extraction | `src/agents/information-extractor.ts` |
| Email drafting | `src/agents/social-agent.ts` |
| Reply classification | `src/skills/reply-classifier.ts` (stub) |
| Follow-up composition | `src/skills/compose-followup.ts` (stub) |
| Plan logging | `skill_runs` table (extend if needed) |
