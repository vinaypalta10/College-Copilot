import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Repo } from "../db/repo.ts";
import type { DB } from "../db/client.ts";
import { authUrl, exchangeCode, isConfigured } from "../auth/google.ts";
import { createSession, setSessionCookie, clearSessionCookie, parseCookies, COOKIE_NAME, type AuthedRequest } from "../auth/session.ts";
import { log } from "../lib/log.ts";

const STATE_COOKIE = "cc_oauth_state";

const devLoginBody = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
});

function devLoginAllowed(): boolean {
  return !isConfigured() || process.env.DEV_LOGIN === "true";
}

export function authRouter(db: DB): Router {
  const router = Router();
  const repo = new Repo(db);

  router.get("/me", (req: AuthedRequest, res) => {
    if (!req.user) {
      res.json({ user: null, googleEnabled: isConfigured(), devLogin: devLoginAllowed() });
      return;
    }
    const profile = repo.getProfile(req.user.id);
    res.json({
      user: { id: req.user.id, email: req.user.email, name: req.user.name },
      hasProfile: Boolean(profile?.major),
      googleEnabled: isConfigured(),
      devLogin: devLoginAllowed(),
    });
  });

  router.get("/google", (_req, res) => {
    if (!isConfigured()) {
      res.status(503).json({ error: "Google OAuth is not configured. Use dev-login or set GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT_URL." });
      return;
    }
    const state = randomBytes(16).toString("hex");
    res.append("Set-Cookie", `${STATE_COOKIE}=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`);
    res.redirect(authUrl(state));
  });

  router.get("/google/callback", async (req: AuthedRequest, res) => {
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      const cookies = parseCookies(req.headers.cookie);
      if (!code || !state || state !== cookies[STATE_COOKIE]) {
        res.status(400).send("Invalid OAuth state");
        return;
      }
      const gUser = await exchangeCode(code);
      const hd = process.env.OAUTH_HOSTED_DOMAIN;
      if (hd && !gUser.email.endsWith(`@${hd}`)) {
        res.status(403).send(`Sign-in restricted to @${hd} accounts.`);
        return;
      }
      const user = repo.upsertUserByGoogle({ id: randomUUID(), google_sub: gUser.sub, email: gUser.email, name: gUser.name });
      const token = createSession(repo, user.id);
      setSessionCookie(res, token);
      res.append("Set-Cookie", `${STATE_COOKIE}=; Path=/; Max-Age=0`);
      res.redirect("/");
    } catch (error) {
      log.error("oauth callback failed", { error: (error as Error).message });
      res.status(500).send("Sign-in failed. Please try again.");
    }
  });

  // Dev/local login — active when Google isn't configured (or DEV_LOGIN=true).
  router.post("/dev-login", (req, res) => {
    if (!devLoginAllowed()) {
      res.status(403).json({ error: "dev-login disabled" });
      return;
    }
    const parsed = devLoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const sub = `dev:${parsed.data.email}`;
    const user = repo.upsertUserByGoogle({
      id: randomUUID(),
      google_sub: sub,
      email: parsed.data.email,
      name: parsed.data.name ?? parsed.data.email.split("@")[0] ?? null,
    });
    const token = createSession(repo, user.id);
    setSessionCookie(res, token);
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  });

  router.post("/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (token) repo.deleteSession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return router;
}
