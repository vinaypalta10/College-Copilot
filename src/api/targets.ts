import { Router } from "express";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { quickAddFromUrl } from "../scanner/quickAdd.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";

interface ApiTarget {
  id: string;
  p: number;
  path: string;
  name: string;
  lab: string | null;
  project: string | null;
  fit: string | null;
  contact: string | null;
  sentence: string | null;
  source: string | null;
  notes: string | null;
  evidence: string | null;
  score: number;
  scoreFacets: { id: string; label: string; hits: number }[];
  extractedAt: string | null;
  lastSeenAt: string | null;
  auto: boolean;
  decision: string;
  checks: Record<string, boolean>;
  decidedAt: string | null;
  recipient: string | null;
  draftDraft: string | null;
  followUp: { id: number; dueAt: string; note: string | null } | null;
}

const quickAddBody = z.object({
  url: z.string().url(),
  hint: z.string().max(200).optional(),
});

function shapeTarget(t: ReturnType<Repo["listTargets"]>[number], decision: ReturnType<Repo["getDecision"]> | undefined, followUp: { id: number; dueAt: string; note: string | null } | null): ApiTarget {
  let facets: { id: string; label: string; hits: number }[] = [];
  if (t.score_facets) {
    try { facets = JSON.parse(t.score_facets); } catch { facets = []; }
  }
  let checks: Record<string, boolean> = {};
  if (decision?.checks) {
    try { checks = JSON.parse(decision.checks); } catch { checks = {}; }
  }
  return {
    id: t.id,
    p: t.priority,
    path: t.path,
    name: t.name,
    lab: t.lab,
    project: t.project,
    fit: t.fit,
    contact: t.contact,
    sentence: t.sentence,
    source: t.source,
    notes: t.notes,
    evidence: t.evidence,
    score: t.score,
    scoreFacets: facets,
    extractedAt: t.extracted_at,
    lastSeenAt: t.last_seen_at,
    auto: !!t.auto,
    decision: decision?.status ?? "pending",
    checks,
    decidedAt: decision?.decided_at ?? null,
    recipient: decision?.recipient ?? null,
    draftDraft: decision?.draft ?? null,
    followUp,
  };
}

export function targetsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/", requireAuth, (req: AuthedRequest, res) => {
    const profile = repo.getProfile(req.user!.id);
    let interests: string[] = [];
    try { interests = profile?.interests ? JSON.parse(profile.interests) : []; } catch { interests = []; }
    const normalizedInterests = interests.map(i => i.toLowerCase()).filter(Boolean);
    const targets = repo.listTargets().sort((a, b) => {
      const interestScore = (target: typeof a) => {
        const text = `${target.name} ${target.lab ?? ""} ${target.project ?? ""} ${target.fit ?? ""} ${target.notes ?? ""} ${target.evidence ?? ""}`.toLowerCase();
        return normalizedInterests.filter(interest => text.includes(interest)).length;
      };
      return interestScore(b) - interestScore(a) || b.score - a.score;
    });
    const decisions = new Map(repo.listDecisions().map(d => [d.target_id, d]));
    const followUps = repo.openFollowUps();
    const followUpByTarget = new Map<string, { id: number; dueAt: string; note: string | null }>();
    for (const f of followUps) {
      if (!followUpByTarget.has(f.target_id)) {
        followUpByTarget.set(f.target_id, { id: f.id, dueAt: f.due_at, note: f.note });
      }
    }
    res.json({
      interests,
      targets: targets.map(t => shapeTarget(t, decisions.get(t.id), followUpByTarget.get(t.id) ?? null)),
    });
  });

  router.post("/from-url", async (req, res) => {
    const parsed = quickAddBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await quickAddFromUrl(repo, parsed.data.url, { hint: parsed.data.hint });
      if (!result.ok) {
        res.status(422).json({ error: result.reason });
        return;
      }
      const decision = repo.getDecision(result.target.id);
      res.json({
        ok: true,
        created: result.created,
        target: shapeTarget(result.target, decision, null),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
