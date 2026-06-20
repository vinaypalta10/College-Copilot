import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { decisionPatch, decisionsBulk } from "../lib/validate.ts";

export function decisionsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.patch("/:id", (req, res) => {
    const parsed = decisionPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const target = repo.getTarget(req.params.id);
    if (!target) {
      res.status(404).json({ error: "target not found" });
      return;
    }
    const existing = repo.getDecision(target.id);
    const next = parsed.data;
    repo.upsertDecision({
      target_id: target.id,
      status: next.status ?? existing?.status ?? "pending",
      checks: next.checks ? JSON.stringify(next.checks) : existing?.checks ?? null,
      decided_at: next.status ? new Date().toISOString() : existing?.decided_at ?? null,
      draft: next.draft ?? existing?.draft ?? null,
      recipient: next.recipient ?? existing?.recipient ?? null,
    });
    res.json({ ok: true });
  });

  router.post("/", (req, res) => {
    const parsed = decisionsBulk.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const targets = repo.listTargets();
    const byPriority = new Map(targets.map(t => [String(t.priority), t]));
    const byId = new Map(targets.map(t => [t.id, t]));
    for (const [key, value] of Object.entries(parsed.data.decisions)) {
      const target = byId.get(key) ?? byPriority.get(key);
      if (!target) continue;
      const existing = repo.getDecision(target.id);
      repo.upsertDecision({
        target_id: target.id,
        status: value.decision ?? existing?.status ?? "pending",
        checks: value.checks ? JSON.stringify(value.checks) : existing?.checks ?? null,
        decided_at: value.decidedAt ?? existing?.decided_at ?? null,
        draft: existing?.draft ?? null,
        recipient: existing?.recipient ?? null,
      });
    }
    res.json({ ok: true });
  });

  return router;
}
