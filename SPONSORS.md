# Sponsor Integration Tracker — UC Berkeley AI Hackathon 2026

How College Copilot qualifies for each sponsor track. Raw challenge text is in the
[Appendix](#appendix-raw-sponsor-requirements) at the bottom; the top is our action plan.

## Tracker

| Sponsor | Track | Official requirement (short) | Our plan | Effort | Owner | Status | Proof |
|---|---|---|---|---|---|---|---|
| **Anthropic** | Built with Claude Code, big-swing in health/edu/economic opportunity | Use Claude Code; tackle a meaningful problem | Already true — built with Claude Code; Claude API powers the advisor + outreach. Education + economic-opportunity story. | XS | | ☐ | Claude Code transcript, `ANTHROPIC_API_KEY` wired in `src/providers/anthropic.ts` |
| **Fetch.ai** | ASI:One Agent Challenge | Agent on Agentverse, Agent Chat Protocol, discoverable via ASI:One, multi-step tool use, no custom frontend | Wrap our **course-advisor** as a uAgent on Agentverse that calls our REST API as tools; runs entirely in ASI:One chat | L | | ☐ | Agentverse profile URL + ASI:One shared chat URL |
| **Redis** | Best Use of Redis | Meaningful use of Redis | Move sessions + RMP/course caches to Redis; add **RediSearch vector** semantic course search | M | | ☐ | Redis connection + code path |
| **The Token Company** | Context compression | Reduce tokens sent to an LLM while preserving quality | Compression layer that shrinks the course-catalog context before the advisor's Claude calls | M | | ☐ | Before/after token counts |

Status: ☐ todo · ◐ in progress · ✅ done & proof captured

---

## Per-sponsor playbook

### 1. Anthropic — **lock this in, ~free** ✅
Need to come up with a better story

### 2. Fetch.ai / ASI:One — **highest strategic fit, biggest effort** ⭐
Their challenge is literally "an agent that understands intent and takes action, no custom
frontend" — which is exactly our **course-advisor** (intent → plan → filter → rank → build
schedule). We already have the hard part (the reasoning + tools); we need to expose it as a
Fetch agent.
- **Plan:** build a Python **uAgent** (`uagents` lib) registered on **Agentverse**, implementing
  the **Agent Chat Protocol**, that calls our existing Express endpoints (`/api/advisor`,
  `/api/schedule/suggest`, `/api/courses`) as tools. The whole workflow then runs inside an
  ASI:One chat — satisfying "no custom frontend."
- **Why it's clean:** our backend is already a tool API; the uAgent is a thin orchestration layer.
  Multi-step tool use + a real executable outcome (a schedule) are built in.
- **Risks:** new stack (Python uAgents, Agentverse hosting, Chat Protocol). Needs a teammate
  comfortable with Python. Budget ~3–5 hrs. **Start this early if we want it.**
- **Deliverables to capture:** Agentverse agent profile URL, a public ASI:One shared chat URL
  showing the full flow, demo video.

### 3. Redis — **solid medium win**
Natural fits (pick one or two and make them visible):
- **Cache** RMP lookups + ranked course-search results (we re-rank the whole catalog per request).
- **Session store** — swap our SQLite sessions (`src/auth/session.ts`) for Redis.
- **RediSearch vector search** — embed course titles/descriptions, store vectors in Redis, do
  semantic "find classes like…" search. This is the strongest "best use" angle and demos well.
- Stretch: pub/sub for live seat-availability updates.

where can we use redis, is for the profile page. I am thinking about courses completed, instead of searching for the website everytime, I think we can develop an algorithm that will make this step easier

### 4. The Token Company — **opportunistic**
When we are integrating redis, we try to develop a system that fits this 

## Integration principles
- Prefer integrations that **show in the demo** — judges reward visible use.
- Keep each behind a **flag/adapter** so a failing sponsor API never breaks the demo (mirrors our keyless/dev-login fallback).
- **Capture proof as you go** (URLs, screenshots, token counts) — don't scramble at hour 19.

---

## Appendix: raw sponsor requirements

### Fetch.ai — ASI:One Agent Challenge ("From Intent to Action")
Build a single- or multi-agent system that: solves a clearly defined real-world problem; performs
multi-step planning/decision-making/orchestration; uses tools/APIs/data/other agents to produce an
executable outcome; is registered on Agentverse and discoverable + usable through ASI:One; allows
the core use case to be demonstrated directly within an ASI:One conversation. Any framework
allowed (Google ADK, LangGraph, CrewAI, OpenAI Agents SDK, Claude Agent SDK, plain Python).

**Mandatory:** register ≥1 agent on Agentverse; implement the Agent Chat Protocol; make it
discoverable + directly usable through ASI:One; demonstrate meaningful tool execution or
agent-to-agent orchestration; complete the primary workflow without a custom frontend; submit a
public GitHub repo with run/test instructions.
**Bonus:** multi-agent collaboration; Payment Protocol + monetization; reliability/error recovery;
real-time data; an agent that could keep operating after the hackathon.
**Deliverables (Devpost):** public ASI:One shared chat URL; Agentverse profile URL(s); public
GitHub URL; short demo video; brief problem/user/outcome description.

### Anthropic
Resource: github.com/anthropics/claude-cookbooks. Tech prize celebrates teams that reach the
furthest: projects built with **Claude Code** that tackle meaningful issues in health, education,
economic opportunity, or any domain where AI could shift what's possible. Aspiration and effort
matter more than outcome — take the biggest swing toward the hardest problem you can.

### Redis
Best Use of Redis Prize + Resources (UC Berkeley AI Hackathon).

### The Token Company
Build a compression solution that reduces the amount of information sent to an LLM while preserving
the context needed for high-quality outputs: a compression system for text/code/conversations/
documents; a model/algorithm/framework that compresses or reconstructs context efficiently; or any
approach that reduces token usage while maintaining/improving downstream performance. Creative
solutions at the model, application, or system level encouraged.
