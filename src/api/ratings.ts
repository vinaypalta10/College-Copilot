import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";

const ratingBody = z.object({
  draft: z.string().min(1).max(10_000),
  rating: z.number().int().min(1).max(5),
  critique: z.string().max(500).optional(),
  writerMode: z.string().max(40).optional(),
  writerModel: z.string().max(80).optional(),
});

export function ratingsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/:targetId", (req, res) => {
    res.json({ ratings: repo.ratingsForTarget(req.params.targetId) });
  });

  router.post("/:targetId", (req, res) => {
    const parsed = ratingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const target = repo.getTarget(req.params.targetId);
    if (!target) {
      res.status(404).json({ error: "target not found" });
      return;
    }
    const id = repo.insertRating({
      target_id: target.id,
      draft: parsed.data.draft,
      rating: parsed.data.rating,
      critique: parsed.data.critique ?? null,
      writer_mode: parsed.data.writerMode ?? null,
      writer_model: parsed.data.writerModel ?? null,
    });
    res.json({ ok: true, id });
  });

  return router;
}
