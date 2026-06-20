import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { prefsFromProfile, rankCourses } from "../scorer/candidates.ts";
import { buildSchedule, parseDayCodes, type SchedulableSection } from "../scorer/scheduleBuilder.ts";
import { shapeCourse } from "./courses.ts";
import { scoreCourse } from "../scorer/courseScore.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

const body = z.object({
  subject: z.string().optional(),
  maxUnits: z.number().min(1).max(30).optional(),
  openOnly: z.boolean().optional(),
  limit: z.number().min(1).max(40).optional(),
});

export function scheduleRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  // Auto-assemble a conflict-free schedule from the best-fitting courses.
  router.post("/suggest", (req: AuthedRequest, res) => {
    const parsed = body.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const term = DEFAULT_TERM;
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));
    const ranked = rankCourses(repo, term, prefs, {
      subject: parsed.data.subject ?? null,
      openOnly: parsed.data.openOnly ?? false,
    }).filter(r => r.cand.section && r.cand.section.start_min != null);

    const top = ranked.slice(0, parsed.data.limit ?? 25);
    const schedulable: SchedulableSection[] = top.map(r => ({
      id: r.cand.section!.id,
      courseId: r.cand.course.id,
      label: `${r.cand.course.subject} ${r.cand.course.number}`,
      units: r.cand.course.units ?? 3,
      fitScore: r.fit.score,
      slot: { days: parseDayCodes(r.cand.section!.days), startMin: r.cand.section!.start_min, endMin: r.cand.section!.end_min },
    }));

    const built = buildSchedule(schedulable, parsed.data.maxUnits ?? 18);
    const byId = new Map(top.map(r => [r.cand.section!.id, r]));
    res.json({
      term,
      totalUnits: built.totalUnits,
      courses: built.chosen.map(s => {
        const r = byId.get(s.id)!;
        return shapeCourse(r.cand, scoreCourse(r.cand, prefs));
      }),
      skipped: built.skipped.map(s => ({ label: s.section.label, reason: s.reason })),
    });
  });

  return router;
}
