import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { listSkills, runSkill, getSkill, SkillNotImplementedError } from "../skills/index.ts";

const runBody = z.object({
  input: z.unknown(),
  targetId: z.string().optional(),
});

export function skillsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/", (_req, res) => {
    const skills = listSkills().map(s => ({
      ...s,
      recentRuns: repo.recentSkillRuns(s.name, 3).map(r => ({
        id: r.id,
        status: r.status,
        targetId: r.target_id,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
        error: r.error,
      })),
    }));
    res.json({ skills });
  });

  router.post("/:name/run", async (req, res) => {
    const skill = getSkill(req.params.name);
    if (!skill) {
      res.status(404).json({ error: `Unknown skill: ${req.params.name}` });
      return;
    }
    const parsed = runBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const output = await runSkill(req.params.name, parsed.data.input, {
        repo,
        targetId: parsed.data.targetId,
      });
      res.json({ ok: true, output });
    } catch (error) {
      if (error instanceof SkillNotImplementedError) {
        res.status(501).json({ error: error.message, status: "stub" });
        return;
      }
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
