import { createHash } from "node:crypto";
import type { DB } from "../db/client.ts";
import { Repo, type ProfessorRow } from "../db/repo.ts";
import { normalizeProfessorName } from "../lib/professors.ts";

const USER_AGENT = "CollegeCopilot/0.3 professor-search";
const TIMEOUT_MS = Number(process.env.BERKELEY_PROFESSOR_TIMEOUT_MS || 7000);

interface FacultySource {
  name: string;
  url: string;
}

const SOURCES: FacultySource[] = [
  { name: "Berkeley EECS CS faculty", url: "https://www2.eecs.berkeley.edu/Faculty/Lists/CS/faculty.html" },
  { name: "Berkeley EECS EE faculty", url: "https://www2.eecs.berkeley.edu/Faculty/Lists/EE/faculty.html" },
];

export interface ProfessorSearchInput {
  query?: string;
  profileTerms?: string[];
  limit?: number;
}

export interface ProfessorResult {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  field: string;
  bio: string;
  source: string;
  sourceName: string;
  score: number;
  imageUrl?: string | null;
  departments?: string[];
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stableId(url: string, name: string): string {
  const hash = createHash("sha1").update(`${url}:${name}`).digest("hex").slice(0, 12);
  return `prof_${hash}`;
}

function findListPageProfessorPhoto(chunk: string, baseUrl: string): string | null {
  const match = chunk.match(/<img[^>]+src=["']([^"']*\/Faculty\/Photos\/Homepages\/[^"']+)["'][^>]*>/i);
  if (!match?.[1]) return null;
  return absolutize(match[1], baseUrl);
}

function termsFor(input: ProfessorSearchInput): string[] {
  const text = [input.query, ...(input.profileTerms || [])].filter(Boolean).join(" ");
  return text.toLowerCase().split(/[^a-z0-9+.#]+/).filter(term => term.length > 2);
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function parseEecsFacultyList(html: string, source: FacultySource): ProfessorResult[] {
  const rows: ProfessorResult[] = [];
  const itemRe = /<div[^>]*\bcc-image-list__item\b[^>]*>[\s\S]*?(?=<div[^>]*\bcc-image-list__item\b[^>]*>|$)/gi;
  const items = [...html.matchAll(itemRe)].map(match => match[0]);

  for (const item of items) {
    const name = stripTags(item.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    if (!name || name.length < 3 || /faculty list/i.test(name)) continue;

    const homepageUrl = item.match(/<a[^>]*href=["']([^"']+)["'][^>]*>\s*<img/i)?.[1]
      || item.match(/<h3[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
      || null;
    const url = homepageUrl ? absolutize(homepageUrl, source.url) : null;

    const text = stripTags(item);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
    const research = text.match(/Research Interests:\s*(.*?)(?:Education:|Office Hours:|Teaching Schedule|Assistants:|$)/i)?.[1]?.trim();
    const title = stripTags(item.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || "")
      || text.match(/^(.*?)(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|Research Interests:|Education:|Office Hours:|$)/i)?.[1]?.trim()
      || null;

    rows.push({
      id: stableId(url || source.url, name),
      name,
      email,
      title: title && title.length < 120 ? title : null,
      field: research || "Research interests not listed on the faculty list.",
      bio: text.slice(0, 500),
      source: url || source.url,
      sourceName: source.name,
      score: 0,
      imageUrl: findListPageProfessorPhoto(item, source.url),
    });
  }

  return rows;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findProfessorImageUrl(html: string, baseUrl?: string, professorName?: string): string | null {
  const normalizedName = professorName ? normalizeForMatch(professorName) : "";
  const candidates = [...html.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)]
    .map(match => {
      const raw = match[0];
      const src = (match[1] || "").trim();
      const absolute = absolutize(src, baseUrl || "");
      if (!absolute || !/\/Faculty\/Photos\/Homepages\//i.test(absolute)) return null;
      const alt = /alt=["']([^"']*)["']/i.exec(raw)?.[1]?.trim() || "";
      return { src: absolute, alt };
    })
    .filter((entry): entry is { src: string; alt: string } => Boolean(entry));

  const exactAlt = candidates.find(candidate => normalizedName && normalizeForMatch(candidate.alt).includes(normalizedName));
  if (exactAlt) return exactAlt.src;

  const nameInSrc = candidates.find(candidate => normalizedName && candidate.src.toLowerCase().includes(normalizedName));
  if (nameInSrc) return nameInSrc.src;

  return candidates[0]?.src ?? null;
}

export function parseEecsFacultyBio(html: string, baseUrl?: string, professorName?: string): { bio: string; field: string | null; email: string | null; title: string | null; imageUrl: string | null } {
  const email = stripTags(html).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  const title = stripTags(html.match(/<h2[^>]*>[\s\S]*?<\/h2>\s*<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "") || null;
  const bio = stripTags(
    html.match(/<h4[^>]*>\s*Biography\s*<\/h4>([\s\S]*?)(?:<h4|<h3|###|Selected Publications|Selected Honors|<\/main>|<\/body>)/i)?.[1] ||
    html.match(/Biography([\s\S]*?)(?:Education|Research Areas|Selected Publications|Selected Honors)/i)?.[1] ||
    "",
  );
  const field = stripTags(
    html.match(/Research Areas<\/h4>([\s\S]*?)(?:<h4|<h3|Research Centers|Selected Publications|<\/main>|<\/body>)/i)?.[1] ||
    html.match(/Research Areas([\s\S]*?)(?:Research Centers|Selected Publications|Selected Honors)/i)?.[1] ||
    "",
  );
  const imageUrl = findProfessorImageUrl(html, baseUrl, professorName);
  return {
    bio: bio || "",
    field: field || null,
    email,
    title: title || null,
    imageUrl,
  };
}

function rankProfessor(professor: ProfessorResult, terms: string[]): number {
  if (!terms.length) return professor.field === "Research interests not listed on the faculty list." ? 30 : 45;
  const hay = `${professor.name} ${professor.title || ""} ${professor.field} ${professor.bio}`.toLowerCase();
  const hits = terms.filter(term => hay.includes(term)).length;
  const nameHit = terms.some(term => professor.name.toLowerCase().includes(term)) ? 20 : 0;
  return hits * 18 + nameHit + Math.min(professor.field.length / 18, 12);
}

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rowToResult(row: ProfessorRow): ProfessorResult {
  const interests = jsonStrings(row.research_interests);
  const departments = jsonStrings(row.departments);
  const sourceNames = jsonStrings(row.source_names);
  const sourceUrls = jsonStrings(row.source_urls);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    field: interests.length ? interests.join(", ") : "Research interests not listed.",
    bio: row.bio || "",
    source: row.profile_url || sourceUrls[0] || "",
    sourceName: sourceNames.join(", ") || "Official UC Berkeley faculty directory",
    score: 0,
    imageUrl: row.image_url,
    departments,
  };
}

function directoryScore(row: ProfessorRow, query: string, profileTerms: string[]): number {
  const normalizedQuery = normalizeProfessorName(query);
  const normalizedName = row.normalized_name;
  const queryTerms = query.toLowerCase().split(/[^a-z0-9+.#]+/).filter(term => term.length > 1);
  const profileTokens = profileTerms.join(" ").toLowerCase().split(/[^a-z0-9+.#]+/).filter(term => term.length > 2);
  const identityText = [row.name, row.title, row.departments].filter(Boolean).join(" ").toLowerCase();
  const researchText = row.research_interests.toLowerCase();
  const bioText = (row.bio || "").toLowerCase();
  const haystack = `${identityText} ${researchText} ${bioText}`;

  let score = 0;
  if (normalizedQuery) {
    if (normalizedName === normalizedQuery) score += 1_000;
    else if (normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName)) score += 700;
    else if (normalizedName.includes(normalizedQuery)) score += 550;

    if (researchText.includes(query.toLowerCase())) score += 140;
    else if (bioText.includes(query.toLowerCase())) score += 90;
    for (const term of queryTerms) {
      if (researchText.includes(term)) score += 50;
      else if (bioText.includes(term)) score += 24;
      else if (identityText.includes(term)) score += 15;
    }
    if (queryTerms.length > 1 && queryTerms.every(term => normalizedName.includes(term))) score += 350;
  }

  const profileHits = profileTokens.filter(term => haystack.includes(term)).length;
  score += Math.min(profileHits * 4, 20);
  if (jsonStrings(row.research_interests).length) score += 10;
  if (row.email) score += 3;
  return score;
}

/** Search the persistent imported directory. Returns [] before the first import. */
export function searchImportedBerkeleyProfessors(
  db: DB,
  input: ProfessorSearchInput,
): ProfessorResult[] {
  const repo = new Repo(db);
  const rows = repo.listProfessors();
  if (!rows.length) return [];
  const query = input.query?.trim() || "";
  const limit = Math.min(input.limit ?? 12, 30);
  const normalizedQuery = normalizeProfessorName(query);
  // Enter strict name-search mode only when the directory actually contains a
  // matching name. Capitalized research topics such as "Differential Equations"
  // must still search expertise and biographies.
  const nameQuery = Boolean(normalizedQuery) && rows.some(row =>
    row.normalized_name === normalizedQuery
    || row.normalized_name.includes(normalizedQuery)
    || normalizedQuery.includes(row.normalized_name)
  );
  return rows
    .map(row => ({ row, score: directoryScore(row, query, input.profileTerms || []) }))
    .filter(({ row, score }) => {
      if (!query) return true;
      if (nameQuery) {
        return row.normalized_name === normalizedQuery
          || row.normalized_name.includes(normalizedQuery)
          || normalizedQuery.includes(row.normalized_name);
      }
      return score > 13;
    })
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map(({ row, score }) => ({
      ...rowToResult(row),
      score: score >= 1_000
        ? 100
        : score >= 700
          ? 98
          : score >= 500
            ? 95
            : Math.min(94, Math.round(35 + 60 * (1 - Math.exp(-score / 150)))),
    }));
}

export async function searchBerkeleyProfessors(input: ProfessorSearchInput): Promise<ProfessorResult[]> {
  const limit = Math.min(input.limit ?? 12, 30);
  const terms = termsFor(input);
  const fetched = await Promise.allSettled(SOURCES.map(async source => ({
    source,
    html: await fetchHtml(source.url),
  })));

  const professors = fetched.flatMap(result => {
    if (result.status !== "fulfilled") return [];
    return parseEecsFacultyList(result.value.html, result.value.source);
  });

  const seen = new Map<string, ProfessorResult>();
  for (const professor of professors) {
    const key = professor.email || professor.name;
    if (!seen.has(key)) seen.set(key, professor);
  }

  const ranked = [...seen.values()]
    .map(professor => ({ ...professor, score: rankProfessor(professor, terms) }))
    .filter(professor => !terms.length || professor.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);

  await Promise.all(ranked.slice(0, 8).map(async professor => {
    try {
      const detail = await fetchHtml(professor.source);
      const parsed = parseEecsFacultyBio(detail, professor.source, professor.name);
      if (parsed.bio) professor.bio = parsed.bio;
      if (parsed.field) professor.field = parsed.field;
      if (parsed.email) professor.email = parsed.email;
      if (parsed.title) professor.title = parsed.title;
      if (parsed.imageUrl) professor.imageUrl = parsed.imageUrl;
    } catch {
      // The list page already contains the key contact/research fields.
    }
  }));

  return ranked;
}
