/**
 * Redis connection adapter — resilient, optional, behind `REDIS_URL`.
 *
 * Mirrors the project's keyless-fallback philosophy: when `REDIS_URL` is unset
 * or the server is unreachable, every caller transparently falls back to SQLite.
 * Redis is a *cache/accelerator* here, never a single point of failure — a dead
 * Redis must never break the demo.
 *
 * Used by `courseCache.ts` to store the assembled Berkeley course catalog so the
 * hot read path (re-ranking the whole catalog on every request) doesn't rebuild
 * its candidate set from SQLite each time.
 */

import { createClient } from "redis";
import { log } from "../lib/log.ts";

/** The slice of the node-redis API we use. Lets tests inject a fake. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { EX?: number }): Promise<unknown>;
  del(keys: string | string[]): Promise<unknown>;
}

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisLike | null> | null = null;
let healthy = false;
let warnedDown = false;

export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/** True once a connection has succeeded at least once and hasn't since errored out. */
export function redisHealthy(): boolean {
  return healthy;
}

/**
 * Lazily connect (once) and return a usable client, or null when Redis is not
 * configured / unreachable. Never throws — callers treat null as "use SQLite".
 */
export async function getRedis(): Promise<RedisLike | null> {
  if (!redisConfigured()) return null;
  if (client && healthy) return client as unknown as RedisLike;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = createClient({
        url: process.env.REDIS_URL,
        socket: {
          // Give up reconnecting after a few tries so we don't spam a dead host;
          // a later getRedis() call will attempt a fresh connection.
          reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 200, 1000)),
          connectTimeout: 3000,
        },
      });
      c.on("error", (err: Error) => {
        healthy = false;
        if (!warnedDown) {
          warnedDown = true;
          log.warn("redis error — falling back to SQLite", { error: err.message });
        }
      });
      await c.connect();
      client = c;
      healthy = true;
      warnedDown = false;
      log.info("redis connected", { url: redactUrl(process.env.REDIS_URL!) });
      return c as unknown as RedisLike;
    } catch (err) {
      healthy = false;
      if (!warnedDown) {
        warnedDown = true;
        log.warn("redis unavailable — falling back to SQLite", { error: (err as Error).message });
      }
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try { await client.quit(); } catch { /* ignore */ }
    client = null;
    healthy = false;
  }
}

/** Strip credentials from a redis:// URL before logging it. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return "redis";
  }
}
