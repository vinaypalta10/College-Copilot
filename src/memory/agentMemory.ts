import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import { log } from "../lib/log.ts";

export interface AgentMemoryEvent {
  userId: string;
  kind: string;
  key: string;
  value: unknown;
  ttlSec?: number;
}

function keyFor(event: AgentMemoryEvent): string {
  const safeKey = createHash("sha1").update(event.key).digest("hex").slice(0, 16);
  return `cc:${event.userId}:${event.kind}:${safeKey}`;
}

function encodeCommand(parts: Array<string | number>): string {
  return `*${parts.length}\r\n${parts.map((part) => {
    const text = String(part);
    return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
  }).join("")}`;
}

function parseRedisUrl(raw: string): { url: URL; tls: boolean } {
  const url = new URL(raw);
  return { url, tls: url.protocol === "rediss:" };
}

async function redisCommand(parts: Array<string | number>): Promise<void> {
  const raw = process.env.REDIS_URL;
  if (!raw) return;

  const { url, tls } = parseRedisUrl(raw);
  const port = Number(url.port || (tls ? 6380 : 6379));
  const host = url.hostname;

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      const commands: string[] = [];
      if (url.password) commands.push(encodeCommand(["AUTH", url.username || "default", url.password]));
      commands.push(encodeCommand(parts));
      socket.write(commands.join(""));
    };
    const socket = tls ? tlsConnect({ host, port }, onConnect) : netConnect({ host, port }, onConnect);
    socket.setTimeout(2000);
    socket.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text.startsWith("-")) reject(new Error(text.trim()));
      else resolve();
      socket.end();
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Redis command timed out"));
    });
    socket.on("error", reject);
  });
}

async function redisRestSet(key: string, value: string, ttlSec?: number): Promise<void> {
  const base = process.env.REDIS_REST_URL;
  const token = process.env.REDIS_REST_TOKEN;
  if (!base || !token) return;

  const url = new URL(`/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, base);
  if (ttlSec) {
    url.searchParams.set("EX", String(ttlSec));
  }
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  await new Promise<void>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } }, (res) => {
      res.resume();
      res.on("end", () => res.statusCode && res.statusCode < 400 ? resolve() : reject(new Error(`Redis REST ${res.statusCode}`)));
    });
    req.setTimeout(2000);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Redis REST command timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function rememberAgentEvent(event: AgentMemoryEvent): Promise<{ backend: "redis" | "redis-rest" | "disabled" }> {
  const key = keyFor(event);
  const value = JSON.stringify({ ...event, storedAt: new Date().toISOString() });

  if (process.env.REDIS_URL) {
    try {
      await redisCommand(event.ttlSec ? ["SET", key, value, "EX", event.ttlSec] : ["SET", key, value]);
      return { backend: "redis" };
    } catch (e) {
      log.warn("redis memory write failed", { error: (e as Error).message });
    }
  }

  if (process.env.REDIS_REST_URL && process.env.REDIS_REST_TOKEN) {
    try {
      await redisRestSet(key, value, event.ttlSec);
      return { backend: "redis-rest" };
    } catch (e) {
      log.warn("redis rest memory write failed", { error: (e as Error).message });
    }
  }

  return { backend: "disabled" };
}
