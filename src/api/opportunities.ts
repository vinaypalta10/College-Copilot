import { Router } from "express";
import { Repo, type TargetRow } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { prefsFromProfile } from "../scorer/candidates.ts";
import { scoreOpportunity } from "../scorer/opportunityScore.ts";
import { discoverResearchOpportunities } from "../agents/research-opportunities/orchestrator.ts";
import { discoverIndustryJobs } from "../agents/industry-jobs/orchestrator.ts";

const CATEGORIES = new Set(["research", "industry"]);

function shape(t: TargetRow, fit: ReturnType<typeof scoreOpportunity>) {
  return {
    id: t.id,
    name: t.name,
    org: t.lab,
    project: t.project,
    fit: t.fit,
    contact: t.contact,
    source: t.source,
    category: t.category ?? "research",
    evidence: t.evidence,
    fitScore: fit.score,
    reasons: fit.reasons,
  };
}

export function opportunitiesRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  // GET /api/opportunities?category=research|industry
  // Returns only agent-discovered cache rows. New data comes from POST /search.
  router.get("/", (req: AuthedRequest, res) => {
    const category = String(req.query.category ?? "research");
    if (!CATEGORIES.has(category)) { res.status(400).json({ error: "category must be research|industry" }); return; }
    const limit = Math.min(Number(req.query.limit ?? 40), 100);
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));

    const opportunities = repo.listOpportunities(category)
      .map(t => ({ t, fit: scoreOpportunity(t, prefs) }))
      .sort((a, b) => b.fit.score - a.fit.score)
      .slice(0, limit)
      .map(({ t, fit }) => shape(t, fit));

    res.json({ category, count: opportunities.length, opportunities });
  });

  router.post("/search", async (req: AuthedRequest, res, next) => {
    try {
      const category = String(req.body?.category ?? "research");
      if (!CATEGORIES.has(category)) { res.status(400).json({ error: "category must be research|industry" }); return; }
      const query = typeof req.body?.query === "string" ? req.body.query : "";
      const limit = Math.min(Number(req.body?.limit ?? 12), 30);
      const search = category === "research" ? discoverResearchOpportunities : discoverIndustryJobs;
      const result = await search({ userId: req.user!.id, query, limit }, { repo });
      res.json({ category, ...result, count: result.opportunities.length });
    } catch (e) {
      next(e);
    }
  });

  router.post("/draft", (req: AuthedRequest, res) => {
    const targetId = String(req.body?.targetId ?? "");
    const target = targetId ? repo.getTarget(targetId) : undefined;
    if (!target) { res.status(404).json({ error: "opportunity not found; run an agent search first" }); return; }

    const user = req.user!;
    const profile = repo.getProfile(user.id);
    const interests = profile?.interests ? JSON.parse(profile.interests) as string[] : [];
    const subject = `Reaching out about ${target.name}`;
    const body = [
      `Hi ${firstName(target.name)},`,
      "",
      `I'm ${user.name || user.email}, a UC Berkeley student${profile?.major ? ` studying ${profile.major}` : ""}.`,
      `College Copilot found ${target.lab || "your group"} while searching for ${target.category === "industry" ? "internship" : "research"} opportunities${interests.length ? ` related to ${interests.slice(0, 3).join(", ")}` : ""}.`,
      target.project ? `The project that stood out was: ${target.project}.` : null,
      "I'd love to learn whether there is a good way for an undergraduate to get involved, contribute, or apply.",
      "",
      "Best,",
      user.name || user.email,
    ].filter(Boolean).join("\n");

    repo.upsertDecision({
      target_id: target.id,
      status: "pending",
      checks: null,
      decided_at: new Date().toISOString(),
      draft: `Subject: ${subject}\n\n${body}`,
      recipient: target.contact?.includes("@") ? target.contact : null,
    });

    res.json({ draft: `Subject: ${subject}\n\n${body}` });
  });

  return router;
}

function firstName(name: string): string {
  const cleaned = name.replace(/[|–—-].*$/, "").trim();
  const first = cleaned.split(/\s+/)[0];
  return first && /^[A-Z][a-z]+/.test(first) ? first : "there";
}
