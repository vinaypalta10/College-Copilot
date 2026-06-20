import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

const createBody = z.object({
  name: z.string().min(1).max(120),
  sectionIds: z.array(z.string()).min(1).max(20),
  term: z.string().optional(),
});

export function plansRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  router.get("/", (req: AuthedRequest, res) => {
    const plans = repo.listSavedPlans(req.user!.id).map(p => ({
      id: p.id, name: p.name, term: p.term, createdAt: p.created_at,
      sectionIds: safeArr(p.section_ids),
    }));
    res.json({ plans });
  });

  router.post("/", (req: AuthedRequest, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const id = randomUUID();
    repo.createSavedPlan({
      id,
      user_id: req.user!.id,
      term: parsed.data.term ?? DEFAULT_TERM,
      name: parsed.data.name,
      section_ids: JSON.stringify(parsed.data.sectionIds),
      created_at: new Date().toISOString(),
    });
    res.json({ ok: true, id });
  });

  router.delete("/:id", (req: AuthedRequest, res) => {
    repo.deleteSavedPlan(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  });

  return router;
}

function safeArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
