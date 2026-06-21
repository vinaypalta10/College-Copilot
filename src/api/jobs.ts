/**
 * Industry-jobs API.
 *
 *   POST /api/jobs/search         run the jobs-orchestrator pipeline
 *   GET  /api/jobs                list cached normalized jobs for the user
 *   POST /api/jobs/resume-prompt  build a resume-tailoring prompt for one job
 *   POST /api/jobs/networking     build manual-click networking leads for one job
 *
 * Nothing here sends a message, email, application, or connection request — the
 * resume prompt and networking leads are prepared for the user to act on.
 */

import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { prefsFromProfile } from "../scorer/candidates.ts";
import { searchJobs, rowToScoredJob } from "../agents/industry-jobs/jobs-orchestrator.ts";
import { buildResumePrompt } from "../agents/industry-jobs/resume-prompt-agent.ts";
import { buildNetworkingLeads } from "../agents/industry-jobs/networking-agent.ts";
import type { NormalizedJob } from "../agents/industry-jobs/types.ts";

export function jobsRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);
  router.use(requireAuth);

  // Cached normalized jobs from the latest searches.
  router.get("/", (req: AuthedRequest, res) => {
    const limit = Math.min(Number(req.query.limit ?? 40), 100);
    const jobs = repo.listJobs(req.user!.id).slice(0, limit).map(rowToScoredJob);
    res.json({ count: jobs.length, jobs });
  });

  router.post("/search", async (req: AuthedRequest, res, next) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query : "";
      const limit = Math.min(Number(req.body?.limit ?? 12), 30);
      const result = await searchJobs({ userId: req.user!.id, query, limit }, { repo });
      res.json({ ...result, count: result.jobs.length });
    } catch (e) {
      next(e);
    }
  });

  router.post("/resume-prompt", (req: AuthedRequest, res) => {
    const job = loadJob(repo, req);
    if (!job) { res.status(404).json({ error: "job not found; run a job search first" }); return; }
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));
    res.json({ jobId: job.id, prompt: buildResumePrompt({ job, prefs }) });
  });

  router.post("/networking", (req: AuthedRequest, res) => {
    const stored = req.body?.jobId ? repo.getJobForUser(String(req.body.jobId), req.user!.id) : undefined;
    if (!stored) { res.status(404).json({ error: "job not found; run a job search first" }); return; }
    const job = rowToScoredJob(stored);
    const prefs = prefsFromProfile(repo.getProfile(req.user!.id));
    const profile = repo.getProfile(req.user!.id);
    const result = buildNetworkingLeads({
      job: { id: job.id, title: job.title, company: job.company, requiredSkills: job.requiredSkills },
      prefs,
      student: { name: req.user!.name || undefined, school: profile?.college || "UC Berkeley" },
    });
    res.json(result);
  });

  return router;
}

/** Resolve the posting from the request body for a resume prompt. */
function loadJob(repo: Repo, req: AuthedRequest): (NormalizedJob & { id: string }) | undefined {
  const jobId = req.body?.jobId ? String(req.body.jobId) : "";
  if (!jobId) return undefined;
  const stored = repo.getJobForUser(jobId, req.user!.id);
  return stored ? rowToScoredJob(stored) : undefined;
}
