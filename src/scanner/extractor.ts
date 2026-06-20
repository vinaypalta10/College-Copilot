export interface PageContent {
  title: string;
  text: string;
  mailto: string | null;
  url: string;
}

export function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function pageTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = match?.[1] ?? fallback;
  return raw.replace(/\s+/g, " ").trim();
}

export function extractMailto(html: string): string | null {
  const mailtoMatch = html.match(/mailto:([^\s"'<>?]+)/i);
  if (mailtoMatch) return mailtoMatch[1] ?? null;
  const inline = cleanHtml(html).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return inline ? inline[0] : null;
}

export function extractContent(html: string, fallbackTitle: string, url: string): PageContent {
  return {
    title: pageTitle(html, fallbackTitle),
    text: cleanHtml(html),
    mailto: extractMailto(html),
    url,
  };
}

export function evidenceSnippet(text: string, keywords: string[], radius = 180): string {
  const lower = text.toLowerCase();
  const hits = keywords
    .map(k => lower.indexOf(k.toLowerCase()))
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  const anchor = hits[0] ?? 0;
  const start = Math.max(0, anchor - radius);
  return text.slice(start, start + radius * 2).trim();
}
