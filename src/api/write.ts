import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { runAgent } from "../agents/index.ts";
import type { SocialAgentInput, SocialAgentOutput } from "../agents/social-agent.ts";
import { writeEmailRequest } from "../lib/validate.ts";

export function writeRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.post("/", async (req, res) => {
    const parsed = writeEmailRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const target = repo.getTarget(parsed.data.targetId);
    if (!target) {
      res.status(404).json({ error: "target not found" });
      return;
    }
    try {
      const out = await runAgent<SocialAgentInput, SocialAgentOutput>("social-agent", {
        target,
        currentDraft: parsed.data.currentDraft,
      }, { repo, targetId: target.id });
      res.json({ ok: true, ...out });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
