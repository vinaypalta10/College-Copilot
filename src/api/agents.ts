import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { listAgents, runAgent, getAgent } from "../agents/index.ts";

const runBody = z.object({
  input: z.unknown(),
  targetId: z.string().optional(),
});

export function agentsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/", (_req, res) => {
    res.json({ agents: listAgents() });
  });

  router.post("/:name/run", async (req, res) => {
    const agent = getAgent(req.params.name);
    if (!agent) {
      res.status(404).json({ error: `Unknown agent: ${req.params.name}` });
      return;
    }
    const parsed = runBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const output = await runAgent(req.params.name, parsed.data.input, {
        repo,
        targetId: parsed.data.targetId,
      });
      res.json({ ok: true, output });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
