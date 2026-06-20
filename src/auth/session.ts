/**
 * Session handling for College Copilot.
 *
 * Sessions are opaque random tokens stored in the `sessions` table and carried
 * in an httpOnly cookie. Because the token is random and validated against the
 * DB on every request, there is nothing to forge — no cookie signing needed.
 */

import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Repo, UserRow } from "../db/repo.ts";

export const COOKIE_NAME = "cc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthedRequest extends Request {
  user?: UserRow;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function createSession(repo: Repo, userId: string): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  repo.createSession(token, userId, expiresAt);
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  res.append("Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`);
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Resolves the session cookie to a user and attaches it to req.user (or leaves it undefined). */
export function attachUser(repo: Repo) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (token) {
      const session = repo.getSession(token);
      if (session && new Date(session.expires_at).getTime() > Date.now()) {
        req.user = repo.getUser(session.user_id);
      } else if (session) {
        repo.deleteSession(token);
      }
    }
    next();
  };
}

/** Gate that 401s when no authenticated user is present. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  next();
}
