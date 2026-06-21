import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { findConflicts, parseDayCodes, type SchedulableSection } from "../scorer/scheduleBuilder.ts";

const DEFAULT_TERM = process.env.COURSE_TERM || "fall-2026";

const createBody = z.object({
  name: z.string().min(1).max(120),
  sectionIds: z.array(z.string()).min(1).max(20),
  term: z.string().optional(),
});

export function plansRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  router.get("/", (req: AuthedRequest, res) => {
    const plans = repo.listSavedPlans(req.user!.id).map(p => ({
      id: p.id, name: p.name, term: p.term, createdAt: p.created_at,
      sectionIds: safeArr(p.section_ids),
      courses: hydratePlan(repo, p.term, safeArr(p.section_ids)),
    }));
    res.json({ plans });
  });

  router.post("/", (req: AuthedRequest, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const term = parsed.data.term ?? DEFAULT_TERM;
    const sections = new Map(repo.sectionsForTerm(term).map(section => [section.id, section]));
    const selected = parsed.data.sectionIds.map(id => sections.get(id));
    if (selected.some(section => !section)) {
      res.status(400).json({ error: "One or more selected sections are unavailable for this term." });
      return;
    }
    const schedulable: SchedulableSection[] = selected.map(section => {
      const course = repo.getCourse(section!.course_id);
      return {
        id: section!.id,
        courseId: section!.course_id,
        label: course ? `${course.subject} ${course.number}` : section!.course_id,
        units: course?.units ?? 3,
        fitScore: 0,
        slot: { days: parseDayCodes(section!.days), startMin: section!.start_min, endMin: section!.end_min },
      };
    });
    const conflicts = findConflicts(schedulable);
    if (conflicts.length) {
      res.status(409).json({ error: `${conflicts[0]![0].label} conflicts with ${conflicts[0]![1].label}.` });
      return;
    }
    const id = randomUUID();
    repo.createSavedPlan({
      id,
      user_id: req.user!.id,
      term,
      name: parsed.data.name,
      section_ids: JSON.stringify(parsed.data.sectionIds),
      created_at: new Date().toISOString(),
    });
    res.json({ ok: true, id });
  });

  router.delete("/:id", (req: AuthedRequest, res) => {
    repo.deleteSavedPlan(String(req.params.id), req.user!.id);
    res.json({ ok: true });
  });

  return router;
}

function safeArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

function hydratePlan(repo: Repo, term: string, sectionIds: string[]) {
  const sections = new Map(repo.sectionsForTerm(term).map(section => [section.id, section]));
  return sectionIds.flatMap(id => {
    const section = sections.get(id);
    if (!section) return [];
    const course = repo.getCourse(section.course_id);
    if (!course) return [];
    return [{
      id: course.id,
      label: `${course.subject} ${course.number}`,
      title: course.title,
      units: course.units,
      section: {
        id: section.id,
        days: section.days,
        startMin: section.start_min,
        endMin: section.end_min,
        location: section.location,
      },
    }];
  });
}
