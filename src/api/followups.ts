import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { followUpRequest } from "../lib/validate.ts";

export function followUpRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/", (_req, res) => {
    res.json({ followUps: repo.openFollowUps() });
  });

  router.post("/", (req, res) => {
    const parsed = followUpRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const target = repo.getTarget(parsed.data.targetId);
    if (!target) {
      res.status(404).json({ error: "target not found" });
      return;
    }
    const id = repo.createFollowUp(target.id, parsed.data.dueAt, parsed.data.note ?? null);
    res.json({ ok: true, id });
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    repo.resolveFollowUp(id);
    res.json({ ok: true });
  });

  return router;
}
