import { createHash } from "node:crypto";
import type { DB } from "../db/client.ts";
import { Repo, type ProfessorRow } from "../db/repo.ts";
import { parseEecsFacultyList } from "../providers/berkeleyProfessors.ts";
import { normalizeProfessorName } from "../lib/professors.ts";

const USER_AGENT = "CollegeCopilot/0.4 faculty-import";
const DEFAULT_TIMEOUT_MS = 12_000;
const VCR_BASE = "https://vcresearch.berkeley.edu";
const VCR_DIRECTORY = `${VCR_BASE}/faculty-expertise`;

export interface FacultyRecord {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  departments: string[];
  researchInterests: string[];
  bio: string | null;
  profileUrl: string | null;
  imageUrl: string | null;
  sourceNames: string[];
  sourceUrls: string[];
}

export interface FacultyImportOptions {
  maxPages?: number;
  enrichDetails?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  fetchHtml?: (url: string) => Promise<string>;
}

export interface FacultyImportSummary {
  sources: number;
  seen: number;
  saved: number;
  errors: string[];
}

export interface DepartmentListSource {
  name: string;
  department: string;
  url: string;
  parser: "eecs" | "drupal-article" | "openberkeley-card" | "faculty-table" | "mcb-list" | "physics-table";
  pages?: number;
}

const DEPARTMENT_SOURCES: DepartmentListSource[] = [
  {
    name: "Berkeley EECS CS faculty",
    department: "Division of Computer Science (EECS)",
    url: "https://www2.eecs.berkeley.edu/Faculty/Lists/CS/faculty.html",
    parser: "eecs",
  },
  {
    name: "Berkeley EECS EE faculty",
    department: "Division of Electrical Engineering (EECS)",
    url: "https://www2.eecs.berkeley.edu/Faculty/Lists/EE/faculty.html",
    parser: "eecs",
  },
  {
    name: "Berkeley Statistics faculty",
    department: "Dept of Statistics",
    url: "https://statistics.berkeley.edu/people/faculty",
    parser: "drupal-article",
  },
  {
    name: "Berkeley Mathematics faculty",
    department: "Dept of Mathematics",
    url: "https://math.berkeley.edu/people/faculty",
    parser: "openberkeley-card",
  },
  {
    name: "Berkeley Integrative Biology faculty",
    department: "Dept of Integrative Biology",
    url: "https://ib.berkeley.edu/people/faculty",
    parser: "faculty-table",
  },
  {
    name: "Berkeley Molecular and Cell Biology faculty",
    department: "Dept of Molecular & Cell Biology",
    url: "https://mcb.berkeley.edu/faculty/all",
    parser: "mcb-list",
  },
  {
    name: "Berkeley Physics faculty",
    department: "Dept of Physics",
    url: "https://physics.berkeley.edu/people/faculty",
    parser: "physics-table",
    pages: 26,
  },
  {
    name: "Berkeley English faculty",
    department: "Dept of English",
    url: "https://english.berkeley.edu/people/faculty",
    parser: "openberkeley-card",
  },
];

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    return new URL(decodeHtml(value), base).toString();
  } catch {
    return null;
  }
}

function professorId(email: string | null, name: string): string {
  const key = email?.trim().toLowerCase() || normalizeProfessorName(name);
  return `prof_${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = raw?.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function anchorTexts(html: string): string[] {
  return unique([...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(match => stripTags(match[1] || "")));
}

function facultyRecord(
  source: DepartmentListSource,
  input: {
    name: string;
    profileUrl?: string | null;
    email?: string | null;
    title?: string | null;
    researchInterests?: string[];
    bio?: string | null;
    imageUrl?: string | null;
  },
): FacultyRecord {
  return {
    id: professorId(input.email || null, input.name),
    name: input.name,
    email: input.email || null,
    title: input.title || null,
    departments: [source.department],
    researchInterests: unique(input.researchInterests || []),
    bio: input.bio || null,
    profileUrl: input.profileUrl || null,
    imageUrl: input.imageUrl || null,
    sourceNames: [source.name],
    sourceUrls: unique([source.url, input.profileUrl]),
  };
}

export function parseDepartmentFacultyList(html: string, source: DepartmentListSource): FacultyRecord[] {
  if (source.parser === "eecs") {
    return parseEecsFacultyList(html, source).map(row => facultyRecord(source, {
      name: row.name,
      email: row.email,
      title: row.title,
      profileUrl: row.source,
      imageUrl: row.imageUrl,
      bio: row.bio,
      researchInterests: row.field === "Research interests not listed on the faculty list."
        ? []
        : row.field.split(/\s*;\s*/).filter(Boolean),
    }));
  }

  if (source.parser === "drupal-article") {
    return [...html.matchAll(/<article\b[^>]*class=["'][^"']*\bnode--type-faculty\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)]
      .map(match => {
        const block = match[1] || "";
        const name = stripTags(block.match(/<h[2-4]\b[^>]*class=["'][^"']*(?:page--title|node__title)[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
        if (!name) return null;
        const href = block.match(/<h[2-4]\b[^>]*class=["'][^"']*(?:page--title|node__title)[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
        const profileUrl = absoluteUrl(href, source.url);
        const title = stripTags(block.match(/field--name-field-job-title[\s\S]*?field__item[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
        const imageUrl = absoluteUrl(block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1], source.url);
        return facultyRecord(source, { name, title, profileUrl, imageUrl });
      })
      .filter((record): record is FacultyRecord => Boolean(record));
  }

  if (source.parser === "openberkeley-card") {
    const records: FacultyRecord[] = [];
    for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/people\/faculty\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const block = match[2] || "";
      const name = stripTags(block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
      if (!name) continue;
      const title = stripTags(block.match(/field-name-field-openberkeley-person-title[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
      const fields = [...block.matchAll(/field-name-field-openberkeley-person-dept[\s\S]*?<div class=["']field-items["']>([\s\S]*?)<\/div>\s*<\/div>/gi)]
        .flatMap(item => [...(item[1] || "").matchAll(/field-item[^>]*>([\s\S]*?)<\/div>/gi)].map(field => stripTags(field[1] || "")));
      const background = block.match(/background-image:\s*url\(['"]?([^'")]+)["']?\)/i)?.[1];
      records.push(facultyRecord(source, {
        name,
        title,
        profileUrl: absoluteUrl(match[1], source.url),
        imageUrl: absoluteUrl(background, source.url),
        researchInterests: fields,
      }));
    }
    const blocks = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bnode-openberkeley-person\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bnode-openberkeley-person\b|$)/gi)];
    for (const match of blocks) {
      const block = match[1] || "";
      const heading = block.match(/<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
      const name = stripTags(heading?.[2] || "");
      if (!name || /faculty|people/i.test(name)) continue;
      const title = stripTags(block.match(/field-name-field-openberkeley-person-title[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
      const fields = [...block.matchAll(/field-name-field-openberkeley-person-dept[\s\S]*?<div class=["']field-items["']>([\s\S]*?)<\/div>\s*<\/div>/gi)]
        .flatMap(item => [...(item[1] || "").matchAll(/field-item[^>]*>([\s\S]*?)<\/div>/gi)].map(field => stripTags(field[1] || "")));
      const background = block.match(/background-image:\s*url\(['"]?([^'")]+)["']?\)/i)?.[1];
      if (records.some(record => normalizeProfessorName(record.name) === normalizeProfessorName(name))) continue;
      records.push(facultyRecord(source, {
        name,
        title,
        profileUrl: absoluteUrl(heading?.[1], source.url),
        imageUrl: absoluteUrl(background, source.url),
        researchInterests: fields,
      }));
    }
    return records;
  }

  if (source.parser === "faculty-table") {
    return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => {
      const row = match[1] || "";
      const profile = row.match(/<a\b[^>]*href=["']([^"']*\/people\/directory\/detail\/[^"']+)["'][^>]*>\s*(?:<strong>)?([\s\S]*?)(?:<\/strong>)?\s*<\/a>/i);
      const name = stripTags(profile?.[2] || "");
      if (!name) return null;
      const email = decodeHtml(row.match(/href=["']mailto:([^"']+)["']/i)?.[1] || "").trim() || null;
      const firstCell = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
      const title = stripTags(firstCell.replace(/<a\b[\s\S]*?<\/a>/i, " "));
      return facultyRecord(source, {
        name,
        email,
        title,
        profileUrl: absoluteUrl(profile?.[1], source.url),
      });
    }).filter((record): record is FacultyRecord => Boolean(record));
  }

  if (source.parser === "mcb-list") {
    return [...html.matchAll(/<p\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/a>\s*<br\s*\/?>([\s\S]*?)<\/p>/gi)]
      .map(match => {
        const name = stripTags(match[2] || "");
        if (!name) return null;
        const body = match[3] || "";
        const title = stripTags(body.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || "");
        const research = stripTags(body.replace(/<strong>[\s\S]*?<\/strong>/i, " "));
        return facultyRecord(source, {
          name,
          title,
          profileUrl: absoluteUrl(match[1], source.url),
          researchInterests: research ? [research] : [],
          bio: research || null,
        });
      })
      .filter((record): record is FacultyRecord => Boolean(record));
  }

  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => {
    const row = match[1] || "";
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => stripTags(cell[1] || ""));
    if (!cells.some(cell => /^faculty$/i.test(cell))) return null;
    const profile = row.match(/<a\b[^>]*href=["']([^"']*\/people\/(?!graduate-student|postdoc)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const name = stripTags(profile?.[2] || "");
    if (!name) return null;
    return facultyRecord(source, {
      name,
      title: cells[1] || null,
      profileUrl: absoluteUrl(profile?.[1], source.url),
    });
  }).filter((record): record is FacultyRecord => Boolean(record));
}

export function parseDepartmentFacultyDetail(html: string, original: FacultyRecord): FacultyRecord {
  const email = decodeHtml(
    html.match(/href\s*=\s*["']mailto:([^"']+)["']/i)?.[1]
    || html.match(/field--name-field-email[\s\S]*?field__item[^>]*>([^<]+)</i)?.[1]
    || "",
  ).trim() || original.email;
  const description = stripTags(
    html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || html.match(/field-name-body[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || "",
  );
  const imageUrl = absoluteUrl(
    html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
    || html.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["'][^"']*["']/i)?.[1],
    original.profileUrl || VCR_BASE,
  );
  return {
    ...original,
    id: professorId(email, original.name),
    email,
    bio: description || original.bio,
    imageUrl: imageUrl || original.imageUrl,
  };
}

export function parseVcrFacultyListPage(html: string): { faculty: FacultyRecord[]; nextUrl: string | null } {
  const faculty: FacultyRecord[] = [];
  const articles = [...html.matchAll(
    /<article\b[^>]*class=["'][^"']*\bfaculty--teaser\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi,
  )];

  for (const match of articles) {
    const article = match[1] || "";
    const nameMatch = article.match(
      /<a\b[^>]*class=["'][^"']*\bfield--name-field-name\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i,
    );
    const name = stripTags(nameMatch?.[1] || "");
    if (!name) continue;

    const profileHref = article.match(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bfield--name-field-name\b/i,
    )?.[1] || article.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*\bfield--name-field-photo\b/i)?.[1];
    const profileUrl = absoluteUrl(profileHref, VCR_BASE);
    const imageUrl = absoluteUrl(article.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1], VCR_BASE);

    const departmentStart = article.indexOf("field--name-field-department");
    const interestsStart = article.indexOf("field--name-field-areas-of-expertise");
    const departmentHtml = departmentStart >= 0
      ? article.slice(departmentStart, interestsStart >= 0 ? interestsStart : article.length)
      : "";
    const interestsHtml = interestsStart >= 0 ? article.slice(interestsStart) : "";
    const departments = anchorTexts(departmentHtml);
    const researchInterests = anchorTexts(interestsHtml);

    faculty.push({
      id: professorId(null, name),
      name,
      email: null,
      title: null,
      departments,
      researchInterests,
      bio: null,
      profileUrl,
      imageUrl,
      sourceNames: ["UC Berkeley Faculty Expertise Finder"],
      sourceUrls: unique([VCR_DIRECTORY, profileUrl]),
    });
  }

  const nextHref = html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*rel=["']next["'][^>]*>/i)?.[1]
    || html.match(/<a\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
  return { faculty, nextUrl: absoluteUrl(nextHref, VCR_DIRECTORY) };
}

function jsonLdPeople(html: string): Record<string, unknown>[] {
  const people: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] || "")) as Record<string, unknown>;
      const nodes = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        if (node && typeof node === "object" && (node as Record<string, unknown>)["@type"] === "Person") {
          people.push(node as Record<string, unknown>);
        }
      }
    } catch {
      // A malformed analytics JSON-LD block should not stop the directory import.
    }
  }
  return people;
}

function organizationName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string") {
    return (value as Record<string, unknown>).name as string;
  }
  return null;
}

export function parseVcrFacultyDetail(html: string, original: FacultyRecord): FacultyRecord {
  const person = jsonLdPeople(html)[0];
  const email = decodeHtml(html.match(/href\s*=\s*["']?mailto:([^"'\s>]+)/i)?.[1] || "").trim() || original.email;
  const description = typeof person?.description === "string"
    ? stripTags(person.description)
    : stripTags(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || "");
  const knowsAbout = Array.isArray(person?.knowsAbout)
    ? person.knowsAbout.filter((value): value is string => typeof value === "string")
    : [];
  const worksFor = organizationName(person?.worksFor);
  const jobTitle = typeof person?.jobTitle === "string" ? person.jobTitle : null;
  const image = typeof person?.image === "string"
    ? absoluteUrl(person.image, original.profileUrl || VCR_BASE)
    : absoluteUrl(html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1], VCR_BASE);

  return {
    ...original,
    id: professorId(email, original.name),
    email,
    title: jobTitle || original.title,
    departments: unique([...original.departments, worksFor]),
    researchInterests: unique([...original.researchInterests, ...knowsAbout]),
    bio: description || original.bio,
    imageUrl: image || original.imageUrl,
  };
}

async function fetchPage(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) output[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return output;
}

function mergeFaculty(records: FacultyRecord[]): FacultyRecord[] {
  const aliases = new Map<string, FacultyRecord>();
  const canonical = new Set<FacultyRecord>();
  for (const record of records) {
    const emailKey = record.email?.trim().toLowerCase();
    const nameKey = normalizeProfessorName(record.name);
    const existing = (emailKey ? aliases.get(`email:${emailKey}`) : undefined)
      || aliases.get(`name:${nameKey}`);
    const merged: FacultyRecord = existing ? {
      ...existing,
      id: professorId(record.email || existing.email, record.name),
      email: record.email || existing.email,
      title: record.title || existing.title,
      departments: unique([...existing.departments, ...record.departments]),
      researchInterests: unique([...existing.researchInterests, ...record.researchInterests]),
      bio: (record.bio?.length || 0) > (existing.bio?.length || 0) ? record.bio : existing.bio,
      profileUrl: record.profileUrl || existing.profileUrl,
      imageUrl: record.imageUrl || existing.imageUrl,
      sourceNames: unique([...existing.sourceNames, ...record.sourceNames]),
      sourceUrls: unique([...existing.sourceUrls, ...record.sourceUrls]),
    } : record;

    if (existing) {
      canonical.delete(existing);
      for (const [key, value] of aliases) {
        if (value === existing) aliases.set(key, merged);
      }
    }
    canonical.add(merged);
    aliases.set(`name:${nameKey}`, merged);
    if (merged.email) aliases.set(`email:${merged.email.toLowerCase()}`, merged);
  }
  return [...canonical];
}

function toRow(record: FacultyRecord, now: string): ProfessorRow {
  return {
    id: professorId(record.email, record.name),
    name: record.name,
    normalized_name: normalizeProfessorName(record.name),
    email: record.email,
    title: record.title,
    departments: JSON.stringify(unique(record.departments)),
    research_interests: JSON.stringify(unique(record.researchInterests)),
    bio: record.bio,
    profile_url: record.profileUrl,
    image_url: record.imageUrl,
    source_names: JSON.stringify(unique(record.sourceNames)),
    source_urls: JSON.stringify(unique(record.sourceUrls)),
    imported_at: now,
    last_seen_at: now,
    active: 1,
  };
}

export async function importBerkeleyFaculty(db: DB, options: FacultyImportOptions = {}): Promise<FacultyImportSummary> {
  const repo = new Repo(db);
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getHtml = options.fetchHtml || ((url: string) => fetchPage(url, timeoutMs));
  const errors: string[] = [];
  const records: FacultyRecord[] = [];
  const runId = repo.startProfessorImport(1 + DEPARTMENT_SOURCES.length);

  let pageUrl: string | null = VCR_DIRECTORY;
  const visitedPages = new Set<string>();
  for (let page = 0; pageUrl && page < maxPages; page++) {
    if (visitedPages.has(pageUrl)) break;
    visitedPages.add(pageUrl);
    try {
      const parsed = parseVcrFacultyListPage(await getHtml(pageUrl));
      records.push(...parsed.faculty);
      pageUrl = parsed.nextUrl;
    } catch (error) {
      errors.push(`UC Berkeley Faculty Expertise Finder (${pageUrl}): ${(error as Error).message}`);
      break;
    }
  }

  if (options.enrichDetails !== false) {
    const detailCandidates = records.filter(record => record.profileUrl);
    const enriched = await mapPool(detailCandidates, concurrency, async record => {
      try {
        return parseVcrFacultyDetail(await getHtml(record.profileUrl!), record);
      } catch (error) {
        errors.push(`${record.name} detail: ${(error as Error).message}`);
        return record;
      }
    });
    const enrichedByUrl = new Map(enriched.map(record => [record.profileUrl, record]));
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (record) records[index] = enrichedByUrl.get(record.profileUrl) || record;
    }
  }

  for (const source of DEPARTMENT_SOURCES) {
    try {
      const departmentRecords: FacultyRecord[] = [];
      for (let page = 0; page < (source.pages || 1); page++) {
        const pageUrl = page === 0 ? source.url : `${source.url}?page=${page}`;
        departmentRecords.push(...parseDepartmentFacultyList(await getHtml(pageUrl), { ...source, url: pageUrl }));
      }
      if (options.enrichDetails !== false) {
        const enriched = await mapPool(departmentRecords, concurrency, async record => {
          if (!record.profileUrl) return record;
          try {
            return parseDepartmentFacultyDetail(await getHtml(record.profileUrl), record);
          } catch (error) {
            errors.push(`${record.name} department detail: ${(error as Error).message}`);
            return record;
          }
        });
        records.push(...enriched);
      } else {
        records.push(...departmentRecords);
      }
    } catch (error) {
      errors.push(`${source.name}: ${(error as Error).message}`);
    }
  }

  const merged = mergeFaculty(records);
  const now = new Date().toISOString();
  const save = db.transaction((faculty: FacultyRecord[]) => {
    for (const record of faculty) repo.upsertProfessor(toRow(record, now));
  });
  save(merged);
  const completedFullImport = pageUrl === null && errors.length === 0;
  if (completedFullImport && merged.length > 0) {
    repo.markProfessorsInactiveExcept(merged.map(record => professorId(record.email, record.name)));
  }
  repo.finishProfessorImport(runId, records.length, merged.length, errors);

  return {
    sources: 1 + DEPARTMENT_SOURCES.length,
    seen: records.length,
    saved: merged.length,
    errors,
  };
}
