# College Copilot

A multi-user agent for UC Berkeley students that does the tedious cross-referencing nobody
enjoys: filtering classes by **remaining requirements**, **RateMyProfessors rating**,
**workload**, and **time constraints**, then letting students add choices to a conflict-checked calendar — and
finding **research opportunities** worth a warm outreach email.

Students normally have many constraints but scattered information; College Copilot gathers it
for them and ranks every class against their profile with a plain-language "why this matches".

> Pivoted from an earlier internship-outreach tool; the current local data is cleaned down to
> Berkeley course data plus curated research/industry opportunities for College Copilot.

## Project status (hackathon — ~20 hrs total)

**Team docs:** [ROADMAP.md](ROADMAP.md) (hour-by-hour build plan) · [SPONSORS.md](SPONSORS.md) (sponsor integration tracker — fill this in).

### ✅ Built so far (working prototype)
- **Auth & multi-user** — Google OAuth + DB-backed sessions, with keyless **dev-login** for local demos.
- **Berkeley course ingestion** — Berkeleytime (catalog, sections, grades) + RateMyProfessors enrichment.
- **Explainable ranking** — every class scored 0-100 vs. your profile with reasons (requirement, RMP, workload, time).
- **Advisor** — natural-language search ("CS, mornings, light workload, ≥3.5 prof") → re-ranked results.
- **Scheduling** — manually add recommended courses → conflict-checked weekly calendar → saved plans.
- **Research tab** — run opportunity agents that fetch live sources and draft outreach.
- **Quality** — deterministic scorer + conflict detection covered by unit tests.
- **Redis catalog cache** — the whole Berkeley catalog (40 subjects, ~1,400 courses) is cached
  in Redis as a read-through snapshot so the advisor/Discover hot path doesn't rebuild its
  candidate set from SQLite on every request. Falls back to SQLite when Redis is absent.

### 🎯 Next 2 hours → demo-ready v1 (for the sponsor walkthrough)
Goal: a smooth, bug-free **happy path** to show. See [ROADMAP.md](ROADMAP.md) for task split.
1. **Browser click-through** of the full flow (sign in → preferences → discover → advisor → schedule). Fix any UI breakage — not yet verified in a real browser.
2. **Import more subjects** (`COMPSCI,DATA,STAT,MATH,EECS,PHYSICS`) so Discover looks rich.
3. **Add the Claude key** (`ANTHROPIC_API_KEY`) so the advisor's NL parsing wows instead of the heuristic.
4. **Seed a demo account** with a realistic profile so the first screen already shows great matches.
5. **Polish empty/error states** and the calendar rendering.

### 🔭 Next 3 hours (after demo) → harden + sponsor hooks
- Per-user research opportunities (real isolation) + richer lab/URAP sources.
- Schedule discussion/lab sub-sections, not just lectures.
- Wire the first sponsor integrations from [SPONSORS.md](SPONSORS.md).
- Deploy a public URL so judges can try it.

## Quick start

```bash
cp .env.example .env       # optional: add a provider key + Google OAuth (both have fallbacks)
npm install
npm run import:courses      # pull the full Fall 2026 catalog from Berkeleytime (+ RateMyProfessors)
npm run dev                # http://localhost:4174
```

No keys are required to run:
- **No Google OAuth** → local **dev-login** (email only) is enabled automatically outside production.
- **No LLM key** → the advisor uses a keyword **heuristic** parser; scoring is fully deterministic.

To enable Google Sign-In, set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT_URL`
(optionally `OAUTH_HOSTED_DOMAIN=berkeley.edu` to restrict to campus accounts).

## What it does

1. **Sign in** (Google or dev-login) — multi-user, per-student data.
2. **Set preferences** — major, completed courses, requirements remaining, interests, time
   window, days off, workload tolerance, minimum professor rating.
3. **Discover** — every class ranked by fit, each card showing units, instructor + RMP rating,
   average GPA, workload estimate, requirement match, meeting time, open seats, and reasons.
4. **Ask the Copilot** — e.g. *"CS upper-div, mornings, manageable workload, nothing below 3.5"* —
   parsed into constraints, merged with your profile, re-ranked.
5. **Schedule** — manually add recommended classes, see conflicts on a weekly calendar, and save plans.
6. **Research** — browse lab / URAP opportunities and draft a warm outreach email (opens Gmail
   compose; nothing sends automatically).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server on `$PORT` (default 4174). |
| `npm start` | Same as dev without watch. |
| `npm run import:courses` | Import all courses + sections + grades from Berkeleytime (the full catalog by default), enrich instructors from RateMyProfessors, then warm the Redis catalog cache + vector index. Optional flags: `--subjects COMPSCI,DATA --per-subject 35 --limit 60 --no-rmp`. Idempotent. |
| `npm run clean:legacy-data` | Remove cached opportunity rows while preserving courses, instructors, users, profiles, and plans. |
| `npm test` | node:test suite (course scoring + calendar conflict detection are pure and unit-tested). |

## Data sources (UC Berkeley)

- **Berkeleytime** GraphQL (`berkeleytime.com/api/graphql`) — catalog, sections, meeting times,
  enrollment, and grade distributions. Primary source, no key required.
- **RateMyProfessors** GraphQL — instructor rating / difficulty / would-take-again, cached on the
  `instructors` table (30-day TTL), rate-limited.
- **UC Berkeley SIS Class/Course API** (`developers.api.berkeley.edu`) — optional official
  upgrade behind a CalNet-issued key (stub; not required).

## Caching (Redis)

The advisor and Discover re-rank the **entire** catalog against your profile on every request.
That ranking is per-user, but its inputs — all courses + the term's sections — are identical
across users and only change on re-import, so they're cached in Redis.

- Set `REDIS_URL` (e.g. `redis://localhost:6379` or a Redis Cloud URL) to enable it.
- `src/db/courseCache.ts` is a **read-through cache**: a request reads `cc:catalog:<term>` from
  Redis; on a miss it builds the snapshot from SQLite and writes it back (30-min TTL, configurable
  via `REDIS_CATALOG_TTL`). `npm run import:courses` warms the cache at the end.
- **Resilient by design** (`src/db/redis.ts`): no `REDIS_URL`, an unreachable host, or a mid-flight
  error all fall back to SQLite — Redis is an accelerator, never a single point of failure.
- Instructor RMP ratings are intentionally read live from SQLite (not cached here) so lazily
  enriched ratings appear immediately.
- `GET /api/healthz` reports `redis.connected` plus catalog cache + vector index `hits/misses/builds`
  so you can watch the cache working in the demo.

### Semantic course search (Redis as a vector store)

Beyond caching, Redis backs a **semantic "find classes like…" search**. Every course is embedded
into a dense vector; the whole index is cached in Redis (`cc:vecidx:<term>`), and a query is embedded
the same way and ranked by cosine similarity.

- `GET /api/courses?q=<text>&semantic=true` → courses ranked by embedding similarity (each result
  carries a `similarity` score), then enriched with the deterministic fit score. Without `semantic=true`
  the endpoint keeps its substring keyword search.
- KNN is computed in Node over the cached vectors, so it runs on **any** Redis — no RediSearch / Redis
  Stack module required. Redis is the durable vector store the hot path reads from.
- The embedder (`src/lib/embed.ts`) is keyless and offline by default (a hashed TF-IDF embedding —
  strong lexical retrieval) and **pluggable**: swap in a hosted neural embedder at the same dimension
  and the Redis store + KNN are unchanged. Falls back to building the index from SQLite with no Redis.
- `npm run import:courses` warms the vector index alongside the catalog cache.

Example: `…?q=machine%20learning%20and%20neural%20networks&semantic=true` surfaces COMPSCI 189,
INDENG 142A, and Statistical Learning Theory; `…?q=climate%20change%20and%20sustainability` surfaces
ENVECON Climate Change Economics, GEOG Global Climate Change, and ANTHRO Climate Change.

## Layout

```
src/
  server.ts            Express entry; mounts routes, session middleware
  auth/                Google OAuth flow + DB-backed cookie sessions
  api/                 Route handlers (zod-validated): auth, profile, courses,
                       advisor, plans, schedule, opportunities
  ingest/              berkeleytime.ts (catalog) + ratemyprofessors.ts (ratings)
  scorer/              courseScore.ts (fit, explainable) + candidates.ts (ranking)
                       + scheduleBuilder.ts (conflict-free assembly)
  agents/              three-agent course planner: query, policy, evaluation
  skills/              professor-rating + registry
  providers/           Claude API (Anthropic) abstraction for advisor
  db/                  SQLite schema + typed repo (better-sqlite3) + migrations;
                       redis.ts (resilient client) + courseCache.ts (read-through catalog cache)
                       + vectorStore.ts (Redis-backed embeddings for semantic search)
  lib/                 embed.ts (keyless hashed TF-IDF embedder) + log, rateLimit, validate, …
  scripts/             import-courses, import-opportunities, clean-legacy-data
public/
  index.html  styles.css  js/app.js   (vanilla ES-module SPA: login, profile, discover,
                                        schedule, research)
tests/                 node:test suites
data/outreach.db       SQLite store (gitignored; override with COLLEGE_COPILOT_DB_PATH)
```

## Environment

Full list with comments in `.env.example`. Highlights:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT_URL` — Google Sign-In (local development falls back to dev-login).
- `OAUTH_HOSTED_DOMAIN` — optional, restrict sign-in to one email domain.
- `COURSE_TERM` — default term (e.g. `fall-2026`). *Named `COURSE_TERM`, not `TERM`, to avoid the shell's `$TERM`.*
- `ANTHROPIC_API_KEY` — Claude API; powers the advisor's NL parsing (heuristic fallback when absent).
- `DEEPGRAM_API_KEY` / `DEEPGRAM_MODEL=nova-3` — optional speech-to-text for mic buttons beside text prompts.
- `REDIS_URL` — enables the Redis course-catalog cache (SQLite fallback when absent/unreachable).
  Optional `REDIS_CATALOG_TTL` (seconds, default 1800).

## Notable behaviors

- **Explainable ranking**: `scoreCourse` is a pure function returning a 0-100 fit plus
  human-readable reasons and flags — easy to test and to show in the UI.
- **Resilient ingestion**: RateMyProfessors misses never fail a course import; the advisor
  degrades from LLM parsing to a keyword heuristic without a key.
- **Storage**: SQLite (WAL). Sessions are opaque DB-backed tokens in httpOnly cookies.
- **Safety**: research outreach never sends automatically — the final action opens Gmail compose.

## Known limitations / next steps

- Imports the lecture (primary) section per course; discussion/lab sub-sections aren't yet
  scheduled individually.
- Research and job search results are isolated per user. Older unowned cache rows are retained
  for migration safety but are not exposed through the multi-user API.
- Requirement matching is text-based against the student's stated remaining requirements; it does
  not yet parse official degree audits.
