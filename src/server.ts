import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/client.ts";
import { Repo } from "./db/repo.ts";
import { targetsRouter } from "./api/targets.ts";
import { decisionsRouter } from "./api/decisions.ts";
import { scanRouter } from "./api/scan.ts";
import { writeRouter } from "./api/write.ts";
import { followUpRouter } from "./api/followups.ts";
import { ratingsRouter } from "./api/ratings.ts";
import { skillsRouter } from "./api/skills.ts";
import { agentsRouter } from "./api/agents.ts";
import { authRouter } from "./api/auth.ts";
import { profileRouter } from "./api/profile.ts";
import { coursesRouter } from "./api/courses.ts";
import { advisorRouter } from "./api/advisor.ts";
import { plansRouter } from "./api/plans.ts";
import { scheduleRouter } from "./api/schedule.ts";
import { attachUser } from "./auth/session.ts";
import "./skills/index.ts";
import "./agents/index.ts";
import { runScan } from "./scanner/runner.ts";
import { rateLimit } from "./lib/rateLimit.ts";
import { log } from "./lib/log.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const port = Number(process.env.PORT || 4174);
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS || 6 * 60 * 60 * 1000);

const db = getDb();
const repo = new Repo(db);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

const writeLimit = rateLimit({ capacity: 10, refillPerSec: 0.2 });
const scanLimit = rateLimit({ capacity: 4, refillPerSec: 0.05 });

// Gate POSTs to expensive routers without throttling the UI's GET-polling.
const limitPosts = (limiter: express.RequestHandler) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.method === "POST" ? limiter(req, res, next) : next();

// Resolve the session cookie -> req.user for every request (no-op when absent).
app.use(attachUser(repo));

app.use("/api/auth", authRouter(db));
app.use("/api/profile", profileRouter(db));
app.use("/api/courses", coursesRouter(db));
app.use("/api/advisor", limitPosts(writeLimit), advisorRouter(db));
app.use("/api/plans", plansRouter(db));
app.use("/api/schedule", scheduleRouter(db));

app.use("/api/targets", targetsRouter(db));
app.use("/api/decisions", decisionsRouter(db));
app.use("/api/scan", scanLimit, scanRouter(db));
app.use("/api/write-email", writeLimit, writeRouter(db));
app.use("/api/followups", followUpRouter(db));
app.use("/api/ratings", ratingsRouter(db));
// Both /api/skills/:name/run and /api/agents/:name/run can issue LLM calls
// (the orchestrator alone chains up to ~4 model calls per request), so we
// rate-limit POSTs but leave GET listings unthrottled for UI polling.
app.use("/api/skills", limitPosts(writeLimit), skillsRouter(db));
app.use("/api/agents", limitPosts(writeLimit), agentsRouter(db));

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, targets: repo.countTargets() });
});

app.use(express.static(publicDir, { extensions: ["html"], index: "index.html" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled error", { error: err.message });
  res.status(500).json({ error: err.message });
});

// Auto-scan is opt-in — when set to "true", the server runs a scan on startup
// and on a SCAN_INTERVAL_MS interval. Each scan issues an LLM call per source,
// so the default OFF protects you from surprise spend.
const autoScan = process.env.AUTO_SCAN === "true";

app.listen(port, () => {
  const sources = repo.listSources().length;
  log.info("server listening", { port, sources, autoScan, scanIntervalMin: Math.round(scanIntervalMs / 60_000) });
  console.log(`College Copilot: http://localhost:${port}`);
  if (!autoScan) console.log("Auto-scan OFF. Set AUTO_SCAN=true in .env to enable periodic scanning.");
});

const intervalHandle = autoScan
  ? setInterval(() => {
      runScan(repo).catch(error => log.warn("scheduled scan failed", { error: (error as Error).message }));
    }, scanIntervalMs)
  : null;

if (autoScan) {
  setTimeout(() => {
    runScan(repo).catch(error => log.warn("initial scan failed", { error: (error as Error).message }));
  }, 2000);
}

process.on("SIGINT", () => {
  if (intervalHandle) clearInterval(intervalHandle);
  log.info("shutdown");
  process.exit(0);
});
