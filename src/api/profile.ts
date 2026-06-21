import { Router } from "express";
import { z } from "zod";
import { Repo, type StudentProfileRow } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";

const profileBody = z.object({
  college: z.string().max(120).optional(),
  major: z.string().max(120).optional(),
  gradYear: z.number().int().min(2024).max(2035).optional(),
  interests: z.array(z.string().max(60)).max(20).optional(),
  completedCourses: z.array(z.string().max(40)).max(200).optional(),
  requirementsRemaining: z.array(z.string().max(80)).max(60).optional(),
  timePrefs: z.object({
    earliest: z.string().optional(),       // "09:00"
    latest: z.string().optional(),         // "17:00"
    daysOff: z.array(z.string()).optional(), // ["F"]
  }).optional(),
  workloadTolerance: z.enum(["light", "medium", "heavy"]).optional(),
  minProfRating: z.number().min(0).max(5).optional(),
});

function shape(row: StudentProfileRow | undefined) {
  const parse = <T>(s: string | null, fallback: T): T => {
    if (!s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    college: row?.college ?? null,
    major: row?.major ?? null,
    gradYear: row?.grad_year ?? null,
    interests: parse<string[]>(row?.interests ?? null, []),
    completedCourses: parse<string[]>(row?.completed_courses ?? null, []),
    requirementsRemaining: parse<string[]>(row?.requirements_remaining ?? null, []),
    timePrefs: parse<Record<string, unknown>>(row?.time_prefs ?? null, {}),
    workloadTolerance: row?.workload_tolerance ?? null,
    minProfRating: row?.min_prof_rating ?? null,
  };
}

export function profileRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.use(requireAuth);

  router.get("/", (req: AuthedRequest, res) => {
    res.json({ profile: shape(repo.getProfile(req.user!.id)) });
  });

  router.put("/", (req: AuthedRequest, res) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const existing = repo.getProfile(req.user!.id);
    const d = parsed.data;
    const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));
    repo.upsertProfile({
      user_id: req.user!.id,
      college: d.college ?? existing?.college ?? null,
      major: d.major ?? existing?.major ?? null,
      grad_year: d.gradYear ?? existing?.grad_year ?? null,
      interests: json(d.interests) ?? existing?.interests ?? null,
      completed_courses: json(d.completedCourses) ?? existing?.completed_courses ?? null,
      requirements_remaining: json(d.requirementsRemaining) ?? existing?.requirements_remaining ?? null,
      time_prefs: json(d.timePrefs) ?? existing?.time_prefs ?? null,
      workload_tolerance: d.workloadTolerance ?? existing?.workload_tolerance ?? null,
      min_prof_rating: d.minProfRating ?? existing?.min_prof_rating ?? null,
      updated_at: new Date().toISOString(),
    });
    res.json({ profile: shape(repo.getProfile(req.user!.id)) });
  });

  return router;
}
