import { log } from "../lib/log.ts";

const robotsCache = new Map<string, { allow: boolean; expiresAt: number }>();
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = "RuoxiOutreachScanner/0.2 (+local)";

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  allowHosts?: string[] | "any";
}

export interface FetchResult {
  ok: true;
  html: string;
  finalUrl: string;
  status: number;
}

export interface FetchFailure {
  ok: false;
  reason: string;
}

export async function checkRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  const cached = robotsCache.get(robotsUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.allow;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(robotsUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      robotsCache.set(robotsUrl, { allow: true, expiresAt: now + ROBOTS_TTL_MS });
      return true;
    }
    const text = await res.text();
    const allow = isAllowed(text, u.pathname, USER_AGENT);
    robotsCache.set(robotsUrl, { allow, expiresAt: now + ROBOTS_TTL_MS });
    return allow;
  } catch {
    robotsCache.set(robotsUrl, { allow: true, expiresAt: now + ROBOTS_TTL_MS });
    return true;
  }
}

function isAllowed(robotsTxt: string, path: string, ua: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    if (!field || rest.length === 0) continue;
    const key = field.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current) {
        current = { agents: [value], rules: [] };
        groups.push(current);
      } else if (current.rules.length === 0) {
        current.agents.push(value);
      } else {
        current = { agents: [value], rules: [] };
        groups.push(current);
      }
    } else if (current && (key === "allow" || key === "disallow")) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const uaLower = ua.toLowerCase();
  const relevant = groups.filter(g => g.agents.some(a => a === "*" || uaLower.includes(a.toLowerCase())));
  if (!relevant.length) return true;
  let longestMatch = { allow: true, length: -1 };
  for (const group of relevant) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      if (path.startsWith(rule.path) && rule.path.length > longestMatch.length) {
        longestMatch = { allow: rule.allow, length: rule.path.length };
      }
    }
  }
  return longestMatch.allow;
}

export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult | FetchFailure> {
  const { timeoutMs = Number(process.env.SCAN_TIMEOUT_MS ?? 15000), retries = 2, allowHosts = "any" } = options;
  const u = new URL(url);
  if (allowHosts !== "any" && !allowHosts.includes(u.host)) {
    return { ok: false, reason: `Host not allowed: ${u.host}` };
  }
  const robotsOk = await checkRobots(url);
  if (!robotsOk) {
    return { ok: false, reason: "Blocked by robots.txt" };
  }
  let lastError = "Unknown error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status >= 500 && attempt < retries) {
          await backoff(attempt);
          continue;
        }
        return { ok: false, reason: lastError };
      }
      const html = await res.text();
      return { ok: true, html, finalUrl: res.url || url, status: res.status };
    } catch (error) {
      clearTimeout(timer);
      lastError = (error as Error).message;
      if (attempt < retries) {
        log.debug("fetch retry", { url, attempt, error: lastError });
        await backoff(attempt);
        continue;
      }
    }
  }
  return { ok: false, reason: lastError };
}

function backoff(attempt: number): Promise<void> {
  const ms = 250 * Math.pow(2, attempt) + Math.random() * 250;
  return new Promise(resolve => setTimeout(resolve, ms));
}
