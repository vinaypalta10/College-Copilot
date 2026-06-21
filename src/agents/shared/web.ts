/**
 * Shared web-fetch + cleaning utilities for discovery specialist agents.
 *
 * These are deterministic tools (no LLM) used by the research and industry-jobs
 * pipelines so each specialist agent can fetch, clean, and key web content the
 * same way. Network access is bounded by a timeout; failures throw so the
 * orchestrator can degrade gracefully and record the failure in its trace.
 */

import { createHash } from "node:crypto";

export const DISCOVERY_USER_AGENT = "CollegeCopilot/0.3 discovery";

/** A fetched + cleaned page, ready for an extractor agent. */
export interface FetchedPage {
  url: string;
  ok: boolean;
  status: number;
  html: string;
  /** Tag-stripped, whitespace-collapsed text. */
  text: string;
  error?: string;
}

/** An anchor extracted from a page: a candidate link + its visible label. */
export interface PageLink {
  url: string;
  label: string;
}

/** Strip scripts/styles/tags and collapse whitespace into readable text. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a possibly-relative href against a base URL; null if invalid. */
export function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Deterministic short id so the same opportunity de-dupes across runs. */
export function stableId(namespace: string, url: string, title: string): string {
  const hash = createHash("sha1").update(`${namespace}:${url}:${title}`).digest("hex").slice(0, 12);
  return `${namespace}_${hash}`;
}

/**
 * Fetch a single page with a hard timeout. Never throws — returns an
 * `ok: false` page with the error so a page-reader agent can record it and
 * continue to the next source.
 */
export async function fetchPage(url: string, timeoutMs = 5000): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": DISCOVERY_USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    const html = res.ok ? await res.text() : "";
    return {
      url,
      ok: res.ok,
      status: res.status,
      html,
      text: stripTags(html),
      ...(res.ok ? {} : { error: `${res.status} ${res.statusText}` }),
    };
  } catch (e) {
    return { url, ok: false, status: 0, html: "", text: "", error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull anchor links + their cleaned labels out of raw HTML. */
export function extractLinks(html: string, baseUrl: string, max = 60): PageLink[] {
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: PageLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) && links.length < max) {
    const href = match[1];
    const rawLabel = match[2];
    if (!href || !rawLabel) continue;
    const url = absolutize(href, baseUrl);
    const label = stripTags(rawLabel);
    if (!url || label.length < 4 || label.length > 180) continue;
    links.push({ url, label });
  }
  return links;
}
