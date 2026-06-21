/**
 * Side-effect module: load a local `.env` into process.env before any other
 * module reads it. Import this FIRST in entrypoints (server, scripts).
 *
 * Uses Node's built-in `process.loadEnvFile` (Node 20.12+). It is a no-op when
 * the file is missing or the runtime is too old — real deployments inject env
 * vars directly and don't ship a `.env`.
 */

import { existsSync } from "node:fs";

type WithLoadEnv = { loadEnvFile?: (path?: string) => void };

const loadEnvFile = (process as unknown as WithLoadEnv).loadEnvFile;

if (typeof loadEnvFile === "function" && existsSync(".env")) {
  try {
    loadEnvFile.call(process, ".env");
  } catch {
    // Malformed or unreadable .env — fall back to whatever is already exported.
  }
}
