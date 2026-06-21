# College Copilot — Hackathon Roadmap

**Total budget:** ~20 hours · **First demo:** in 2 hours (sponsor walkthrough) · **Team project.**

Philosophy: **prototype first, polish the happy path, then deepen.** Always keep `main` demoable.

---

## Where we are now (T+0) — working prototype ✅

A full vertical slice already runs end-to-end (see README "Built so far"). The engine is solid;
the gap is **demo polish** (not yet clicked through in a browser) and **breadth of data**.

Biggest risks before showing anyone:
1. Frontend never opened in a real browser — possible small JS/CSS bugs.
2. Only CS+DATA imported → Discover can look thin.
3. Advisor uses the keyword heuristic (no LLM key) → less impressive.

---

## Hour 0–2 → **Demo-ready v1** (do these first)

Parallelizable across the team. Each item lists a suggested owner slot.

| # | Task | Owner | Done when |
|---|------|-------|-----------|
| 1 | **Browser click-through** of sign in → profile → discover → advisor → schedule → save plan. Log every bug. | Dev A | Full happy path works, no console errors |
| 2 | Fix bugs found in #1 (UI/CSS/state) | Dev A | — |
| 3 | **Import more subjects**: `npm run import:courses -- --subjects COMPSCI,DATA,STAT,MATH,EECS,PHYSICS` | Dev B | ≥300 courses, ratings populated |
| 4 | Add `ANTHROPIC_API_KEY` to `.env` (Claude), confirm advisor uses LLM parse | Dev B | Advisor handles a fuzzy query well |
| 5 | **Seed demo account** profile (CS major, realistic completed/remaining) so first load shows strong matches | Dev C | Demo login lands on great results |
| 6 | Polish empty states, calendar layout, score-badge colors, mobile width | Dev C | Looks clean on a projector |
| 7 | Write the **90-second demo script** (what to click, what to say) | PM | One-pager in this repo |

**Demo script target story:** "I'm a CS junior. I tell College Copilot *'finish my upper-div
requirement, mornings only, no prof below 3.5, manageable workload'* → it ranks classes with
reasons, I add three to a conflict-checked calendar, and over in Research it drafts a
warm email to a lab. All in 30 seconds."

---

## Hour 2–5 → Harden + first sponsor hooks

After the demo, raise the floor and start qualifying for sponsor prizes (track in `SPONSORS.md`).

- [ ] **Deploy a public URL** (Render/Railway/Fly) with a real domain so judges can try it. *(also a likely sponsor track)*
- [ ] **Per-user research opportunities** — scope `targets` by `user_id`, add a URAP/lab scanner source so the Research tab is real, not legacy demo data.
- [ ] **Course detail view** — click a card → modal with grade distribution chart, all sections, prereqs, RMP review snippets.
- [ ] Wire **sponsor integration #1** (whichever is fastest — see `SPONSORS.md`).
- [ ] Persist the **shortlist/cart server-side** (currently localStorage) so it survives devices.

---

## Hour 5–12 → Depth & differentiation

- [ ] **Schedule discussion/lab sub-sections**, not just lectures (multi-meeting courses).
- [ ] **Requirement engine**: import a major's requirement list (e.g. CS) and auto-detect which are unmet from completed courses — replaces free-text matching.
- [ ] **Multi-plan compare** + drag-to-swap sections on the calendar.
- [ ] **Conversational advisor** (follow-ups: "swap the 8am for something later").
- [ ] **Wire remaining sponsor integrations** + collect proof (screenshots, env, code refs) for submissions.
- [ ] Grade-distribution + RMP **charts** in course detail.

## Hour 12–18 → Polish for judging

- [ ] Onboarding wizard (3 steps) instead of one big form.
- [ ] Loading skeletons, toasts, keyboard nav, dark-mode pass.
- [ ] Error/observability: friendly errors, basic request logging.
- [ ] **Devpost write-up** + architecture diagram + 2-min video.
- [ ] Seed 2–3 demo personas (different majors) for live Q&A.

## Hour 18–20 → Submit

- [ ] Freeze features. Final bug bash on the deployed URL.
- [ ] Verify each sponsor track's requirements are met (`SPONSORS.md` all green).
- [ ] Record final demo video; submit Devpost; tag the repo.

---

## "How do we improve the current version?" — prioritized

Ranked by **impact ÷ effort** for the next few hours:

1. **Browser click-through + fixes** (highest — we literally haven't seen it run). *15–45 min.*
2. **More subjects imported** — makes everything feel real. *5 min.*
3. **LLM key for the advisor** — the "wow" of the demo. *5 min.*
4. **Deploy a public URL** — lets sponsors/judges self-serve + qualifies tracks. *30–60 min.*
5. **Course detail + grade charts** — visual depth that demos well. *1–2 hr.*
6. **Real requirement engine** — the core value prop, biggest differentiator. *2–3 hr.*

---

## Division of labor (suggested)

- **Frontend (Dev A/C):** click-through, polish, course detail modal, charts, onboarding.
- **Backend/Data (Dev B):** imports, requirement engine, per-user research, deploy.
- **Integrations/PM:** `SPONSORS.md` ownership, demo script, Devpost, video.

## Definition of done for the demo
A teammate who has never seen it can: log in (dev-login), set preferences, get ranked classes
with reasons, ask one natural-language question, manually build a conflict-checked schedule, and save it
— with no crashes and on a public or local URL.
