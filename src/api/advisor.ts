import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { advise } from "../agents/course-advisor.ts";
import { shapeCourse } from "./courses.ts";

const body = z.object({ query: z.string().min(1).max(400), term: z.string().optional() });

export function advisorRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  router.post("/", async (req: AuthedRequest, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const out = await advise(
        { userId: req.user!.id, query: parsed.data.query, term: parsed.data.term },
        { repo },
      );
      res.json({
        summary: out.summary,
        constraints: out.constraints,
        count: out.results.length,
        courses: out.results.map(({ cand, fit }) => shapeCourse(cand, fit)),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
