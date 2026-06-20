import type { Request, Response, NextFunction } from "express";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  capacity: number;
  refillPerSec: number;
  keyFn?: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions) {
  const { capacity, refillPerSec, keyFn } = options;
  const buckets = new Map<string, Bucket>();

  return function (req: Request, res: Response, next: NextFunction): void {
    const key = (keyFn ?? defaultKey)(req);
    const now = Date.now();
    const existing = buckets.get(key);
    let tokens = capacity;
    if (existing) {
      const elapsedSec = (now - existing.updatedAt) / 1000;
      tokens = Math.min(capacity, existing.tokens + elapsedSec * refillPerSec);
    }
    if (tokens < 1) {
      res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
      return;
    }
    buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    next();
  };
}

function defaultKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
