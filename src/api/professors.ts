import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import {
  searchBerkeleyProfessors,
  searchImportedBerkeleyProfessors,
} from "../providers/berkeleyProfessors.ts";

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function professorsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  router.post("/search", async (req: AuthedRequest, res, next) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      const limit = Math.min(Number(req.body?.limit ?? 12), 30);
      const profile = repo.getProfile(req.user!.id);
      const profileTerms = [
        profile?.major,
        ...parseJsonList(profile?.interests),
        ...parseJsonList(profile?.requirements_remaining),
      ].filter((item): item is string => Boolean(item));
      let professors = searchImportedBerkeleyProfessors(db, { query, profileTerms, limit });
      let mode = "imported-berkeley-directory";
      // Preserve the old behavior for a fresh clone until `npm run import:professors`
      // has populated the local directory.
      if (!professors.length && repo.countProfessors() === 0) {
        professors = await searchBerkeleyProfessors({ query, profileTerms, limit });
        mode = "live-eecs-fallback";
      }
      res.json({
        mode,
        directorySize: repo.countProfessors(),
        count: professors.length,
        professors,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
