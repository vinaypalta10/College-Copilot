import "./lib/loadEnv.ts";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./db/client.ts";
import { Repo } from "./db/repo.ts";
import { authRouter } from "./api/auth.ts";
import { profileRouter } from "./api/profile.ts";
import { coursesRouter } from "./api/courses.ts";
import { advisorRouter } from "./api/advisor.ts";
import { plansRouter } from "./api/plans.ts";
import { scheduleRouter } from "./api/schedule.ts";
import { opportunitiesRouter } from "./api/opportunities.ts";
import { jobsRouter } from "./api/jobs.ts";
import { professorsRouter } from "./api/professors.ts";
import { voiceRouter } from "./api/voice.ts";
import { attachUser } from "./auth/session.ts";
import "./skills/index.ts";
import "./agents/index.ts";
import { rateLimit } from "./lib/rateLimit.ts";
import { log } from "./lib/log.ts";
import { getRedis, redisConfigured, redisHealthy, closeRedis } from "./db/redis.ts";
import { cacheStats } from "./db/courseCache.ts";
import { vectorStats } from "./db/vectorStore.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const port = Number(process.env.PORT || 4174);

const db = getDb();
const repo = new Repo(db);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));

const writeLimit = rateLimit({ capacity: 10, refillPerSec: 0.2 });

// Gate POSTs to LLM-touching routers without throttling the UI's GET polling.
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
app.use("/api/opportunities", opportunitiesRouter(db));
app.use("/api/jobs", limitPosts(writeLimit), jobsRouter(db));
app.use("/api/professors", limitPosts(writeLimit), professorsRouter(db));
app.use("/api/voice", limitPosts(writeLimit), voiceRouter());

app.get("/api/healthz", (_req, res) => {
  res.json({
    ok: true,
    courses: repo.countCourses(),
    professors: repo.countProfessors(),
    redis: {
      configured: redisConfigured(),
      connected: redisHealthy(),
      catalogCache: { ...cacheStats },
      vectorIndex: { ...vectorStats },
    },
  });
});

app.use(express.static(publicDir, { extensions: ["html"], index: "index.html" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled error", { error: err.message });
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "internal server error" : err.message });
});

const server = app.listen(port, () => {
  log.info("server listening", { port, courses: repo.countCourses() });
  console.log(`College Copilot: http://localhost:${port}`);
  // Warm the Redis connection (and surface its status) without blocking startup.
  if (redisConfigured()) {
    getRedis().then(r => {
      if (r) console.log("Redis: connected (course catalog cache active)");
      else console.log("Redis: configured but unreachable — using SQLite fallback");
    });
  } else {
    console.log("Redis: not configured (set REDIS_URL to enable the catalog cache)");
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutdown", { signal });
  server.close(async () => {
    await closeRedis();
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
