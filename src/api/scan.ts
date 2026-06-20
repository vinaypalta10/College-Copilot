import { Router } from "express";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { runScan, scannerState } from "../scanner/runner.ts";
import { log } from "../lib/log.ts";

export function scanRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/status", (_req, res) => {
    const lastScan = repo.lastScan();
    res.json({
      scanning: scannerState.running,
      lastScanStartedAt: scannerState.startedAt ?? lastScan?.started_at ?? null,
      lastScanFinishedAt: scannerState.finishedAt ?? lastScan?.finished_at ?? null,
      lastScanError: scannerState.lastError ?? lastScan?.error ?? null,
      lastScanAdded: scannerState.lastAdded || lastScan?.added || 0,
      lastScanUpdated: scannerState.lastUpdated || lastScan?.updated || 0,
      scanCount: scannerState.count,
      progress: scannerState.progress,
      totalSources: scannerState.totalSources,
    });
  });

  router.post("/", (_req, res) => {
    if (scannerState.running) {
      res.status(202).json({ ok: true, status: "already_running" });
      return;
    }
    runScan(repo).catch(error => {
      log.error("scan errored", { error: (error as Error).message });
    });
    res.status(202).json({ ok: true, status: "scan_started" });
  });

  return router;
}
