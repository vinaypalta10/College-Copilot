/**
 * Load `.env` into process.env using Node's built-in parser (no dependency).
 *
 * IMPORTANT: tsx does NOT auto-load .env, and nothing else did either — so keys
 * like DEEPGRAM_API_KEY / REDIS_URL / ANTHROPIC_API_KEY placed in .env were
 * silently ignored. This module fixes that. Import it FIRST from every entry
 * point (server, scripts) so process.env is populated before any other module
 * reads a config value at import time.
 *
 * Real environment variables already set in the shell take precedence (we pass
 * `{ path }` to loadEnvFile, which does not override existing process.env keys
 * is NOT guaranteed across versions, so we snapshot + restore pre-set keys).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const path = process.env.DOTENV_PATH || join(process.cwd(), ".env");

if (existsSync(path) && typeof process.loadEnvFile === "function") {
  // Preserve any keys already set in the real environment (shell wins over .env).
  const preset = { ...process.env };
  try {
    process.loadEnvFile(path);
    for (const [k, v] of Object.entries(preset)) {
      if (v !== undefined) process.env[k] = v;
    }
  } catch (err) {
    console.warn(`[env] could not load ${path}: ${(err as Error).message}`);
  }
}
