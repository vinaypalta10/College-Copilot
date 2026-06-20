/**
 * fetch-page skill — atomic tool.
 *
 * Given a URL, returns the cleaned text + title + first detected email.
 * Honors robots.txt, has timeout + retries.
 */

import { registerSkill, type Skill } from "./registry.ts";
import { fetchPage } from "../scanner/fetcher.ts";
import { extractContent } from "../scanner/extractor.ts";

export interface FetchPageInput {
  url: string;
  hint?: string;
}

export interface FetchPageOutput {
  ok: boolean;
  title?: string;
  text?: string;
  mailto?: string | null;
  finalUrl?: string;
  reason?: string;
}

export const fetchPageSkill: Skill<FetchPageInput, FetchPageOutput> = {
  name: "fetch-page",
  description: "HTTP-fetch a page (with robots.txt check, timeout, retries) and extract its title, text, and any mailto: address.",
  status: "active",
  run: async (input) => {
    const result = await fetchPage(input.url);
    if (!result.ok) return { ok: false, reason: result.reason };
    const content = extractContent(result.html, input.hint ?? input.url, result.finalUrl);
    return {
      ok: true,
      title: content.title,
      text: content.text,
      mailto: content.mailto,
      finalUrl: result.finalUrl,
    };
  },
};

registerSkill(fetchPageSkill);
