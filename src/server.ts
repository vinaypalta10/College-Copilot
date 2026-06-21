import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db/client.ts";
import { Repo } from "./db/repo.ts";
import { authRouter } from "./api/auth.ts";
import { profileRouter } from "./api/profile.ts";
import { coursesRouter } from "./api/courses.ts";
import { advisorRouter } from "./api/advisor.ts";
import { plansRouter } from "./api/plans.ts";
import { scheduleRouter } from "./api/schedule.ts";
import { opportunitiesRouter } from "./api/opportunities.ts";
import { attachUser } from "./auth/session.ts";
import "./skills/index.ts";
import "./agents/index.ts";
import { rateLimit } from "./lib/rateLimit.ts";
import { log } from "./lib/log.ts";

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
app.use("/api/advisor", limitPosts(writeLimit), advisorRouter(db)); // runs the multi-agent pipeline
app.use("/api/plans", plansRouter(db));
app.use("/api/schedule", scheduleRouter(db));
app.use("/api/opportunities", opportunitiesRouter(db));

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, courses: repo.countCourses() });
});

app.use(express.static(publicDir, { extensions: ["html"], index: "index.html" }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled error", { error: err.message });
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  log.info("server listening", { port, courses: repo.countCourses() });
  console.log(`College Copilot: http://localhost:${port}`);
});

process.on("SIGINT", () => {
  log.info("shutdown");
  process.exit(0);
});
