# College Copilot

A multi-user agent for UC Berkeley students that does the tedious cross-referencing nobody
enjoys: filtering classes by **remaining requirements**, **RateMyProfessors rating**,
**workload**, and **time constraints**, then assembling a **conflict-free schedule** — and
finding **research opportunities** worth a warm outreach email.

Students normally have many constraints but scattered information; College Copilot gathers it
for them and ranks every class against their profile with a plain-language "why this matches".

> Pivoted from an earlier internship-outreach tool; the current local data is cleaned down to
> Berkeley course data plus curated research/industry opportunities for College Copilot.

## Project status (hackathon — ~20 hrs total)

**Team docs:** [ROADMAP.md](ROADMAP.md) (hour-by-hour build plan) · [SPONSORS.md](SPONSORS.md) (sponsor integration tracker — fill this in).

### ✅ Built so far (working prototype)
- **Auth & multi-user** — Google OAuth + DB-backed sessions, with keyless **dev-login** for demos.
- **Berkeley course ingestion** — Berkeleytime (catalog, sections, grades) + RateMyProfessors enrichment.
- **Explainable ranking** — every class scored 0-100 vs. your profile with reasons (requirement, RMP, workload, time).
- **Advisor** — natural-language search ("CS, mornings, light workload, ≥3.5 prof") → re-ranked results.
- **Scheduling** — shortlist → auto-built conflict-free timetable → weekly calendar → saved plans.
- **Research tab** — run opportunity agents that fetch live sources, rank results, and draft outreach.
- **Quality** — deterministic scorer + schedule builder covered by unit tests.

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
- **No Google OAuth** → local **dev-login** (email only) is enabled automatically.
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
5. **Schedule** — add classes to a shortlist, auto-build a conflict-free timetable (unit-capped),
   see clashes on a weekly calendar, and save plans.
6. **Research** — browse lab / URAP opportunities and draft a warm outreach email (opens Gmail
   compose; nothing sends automatically).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server on `$PORT` (default 4174). |
| `npm start` | Same as dev without watch. |
| `npm run import:courses` | Import all courses + sections + grades from Berkeleytime, then enrich instructors from RateMyProfessors. Optional flags: `--term fall-2026 --subjects COMPSCI,DATA,STAT,MATH --limit 60 --no-rmp`. Idempotent. |
| `npm run clean:legacy-data` | Remove cached opportunity rows while preserving courses, instructors, users, profiles, and plans. |
| `npm test` | node:test suite (course scoring + schedule builder are pure & fully unit-tested). |

## Data sources (UC Berkeley)

- **Berkeleytime** GraphQL (`berkeleytime.com/api/graphql`) — catalog, sections, meeting times,
  enrollment, and grade distributions. Primary source, no key required.
- **RateMyProfessors** GraphQL — instructor rating / difficulty / would-take-again, cached on the
  `instructors` table (30-day TTL), rate-limited.
- **UC Berkeley SIS Class/Course API** (`developers.api.berkeley.edu`) — optional official
  upgrade behind a CalNet-issued key (stub; not required).

## Layout

```
src/
  server.ts            Express entry; mounts routes, session middleware
  auth/                Google OAuth flow + DB-backed cookie sessions
  api/                 Route handlers (zod-validated): auth, profile, courses,
                       advisor, plans, schedule, opportunities
  ingest/              berkeleytime.ts (catalog) + ratemyprofessors.ts (ratings)
  scorer/              courseScore.ts (fit, explainable) + candidates.ts (ranking)
                       + scheduleBuilder.ts (conflict-free assembly) + opportunityScore.ts
  agents/              advising orchestrator + course/schedule/professor specialists
  skills/              professor-rating + registry
  providers/           Claude API (Anthropic) abstraction for advisor
  db/                  SQLite schema + typed repo (better-sqlite3) + migrations
  scripts/             import-courses, import-opportunities, clean-legacy-data
public/
  index.html  styles.css  js/app.js   (vanilla ES-module SPA: login, profile, discover,
                                        schedule, research)
tests/                 node:test suites
data/outreach.db       SQLite store (gitignored; override with COLLEGE_COPILOT_DB_PATH)
```

## Environment

Full list with comments in `.env.example`. Highlights:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OAUTH_REDIRECT_URL` — Google Sign-In (falls back to dev-login).
- `OAUTH_HOSTED_DOMAIN` — optional, restrict sign-in to one email domain.
- `COURSE_TERM` — default term (e.g. `fall-2026`). *Named `COURSE_TERM`, not `TERM`, to avoid the shell's `$TERM`.*
- `ANTHROPIC_API_KEY` — Claude API; powers the advisor's NL parsing (heuristic fallback when absent).

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
- Research-opportunity data is currently shared (seeded from curated local JSON) rather than
  per-user; full per-user isolation of the outreach pipeline is a follow-up.
- Requirement matching is text-based against the student's stated remaining requirements; it does
  not yet parse official degree audits.
