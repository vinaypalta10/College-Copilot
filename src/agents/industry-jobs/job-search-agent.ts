/**
 * job-search-agent — query-driven discovery of real openings across industries.
 *
 * The query drives the search, not a fixed company list. We fan out to real
 * job-search APIs that accept a free-text role + location:
 *
 *   - Adzuna   (keyed, all industries + location) — primary when configured
 *   - Remotive (keyless, remote roles, search=)   — tech/remote breadth
 *   - The Muse (keyless, industry + location)      — finance, consulting, etc.
 *   - ATS boards (Greenhouse/Ashby/Lever)          — rich big-tech descriptions,
 *                                                     only for tech-leaning queries
 *
 * So "machine learning at a startup", "investment banking on the east coast", or
 * "product design remote" each resolve to postings that actually match. Results
 * are merged, relevance-ranked against the query, and deduped. Providers that
 * 404 or are unconfigured are skipped, so the agent always returns something.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import { stripTags } from "../shared/web.ts";
import type { NormalizedJob, RawJobCandidate } from "./types.ts";

// ─────────────────────────── query understanding ───────────────────────────

/** Coarse location aliases → a concrete place the job APIs understand. */
const LOCATION_ALIASES: Array<{ re: RegExp; where: string }> = [
  { re: /\beast coast\b/i, where: "New York" },
  { re: /\bwest coast\b/i, where: "San Francisco" },
  { re: /\b(bay area|silicon valley)\b/i, where: "San Francisco" },
  { re: /\bnyc\b/i, where: "New York" },
  { re: /\bla\b|\bsocal\b/i, where: "Los Angeles" },
  { re: /\bdc\b|\bwashington\b/i, where: "Washington" },
  { re: /\bseattle\b/i, where: "Seattle" },
  { re: /\bboston\b/i, where: "Boston" },
  { re: /\baustin\b/i, where: "Austin" },
  { re: /\bchicago\b/i, where: "Chicago" },
  { re: /\bsan francisco\b|\bsf\b/i, where: "San Francisco" },
  { re: /\bnew york\b/i, where: "New York" },
];

const STOPWORDS = new Set([
  "job", "jobs", "role", "roles", "position", "positions", "opening", "openings",
  "in", "on", "at", "the", "a", "an", "for", "with", "near", "and", "or", "of",
  "internship", "intern", "internships", "remote", "hybrid", "onsite",
  "east", "west", "coast", "area", "bay",
]);

export interface ParsedQuery {
  /** Cleaned role/skill text passed as the API "what" parameter. */
  what: string;
  /** Concrete location, or undefined for anywhere. */
  where?: string;
  remote: boolean;
  /** Lowercased keyword tokens used for local relevance ranking. */
  terms: string[];
  /** True when the query reads like a software/data/AI role. */
  tech: boolean;
}

export function parseQuery(raw: string): ParsedQuery {
  const query = raw.trim();
  const lower = query.toLowerCase();
  const remote = /\bremote\b/.test(lower);

  let where: string | undefined;
  let stripped = query;
  for (const { re, where: w } of LOCATION_ALIASES) {
    if (re.test(query)) { where = w; stripped = stripped.replace(re, " "); break; }
  }

  const terms = lower.split(/[^a-z0-9+.#]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const what = stripped.replace(/\b(remote|hybrid|onsite|east coast|west coast|bay area)\b/gi, " ").replace(/\s+/g, " ").trim();
  const tech = /\b(software|engineer|engineering|developer|swe|ml|machine learning|ai\b|data|backend|frontend|full[\s-]?stack|devops|sre|security|robotics|nlp|computer vision|programming|web|mobile|ios|android)\b/i.test(lower);

  return { what: what || query, where, remote, terms, tech };
}

// ─────────────────────────────── helpers ───────────────────────────────────

const UA = "CollegeCopilot/0.3 job-search";

async function fetchJson<T>(url: string, timeoutMs: number, accept = "application/json"): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept }, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Decode HTML entities embedded in API description fields, then strip tags. */
function cleanDescription(raw: string): string {
  const decoded = raw
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return stripTags(decoded).slice(0, 4000);
}

function mapEmployment(raw: string | undefined): NormalizedJob["employmentType"] | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("intern")) return "internship";
  if (s.includes("part")) return "part_time";
  if (s.includes("temporary") || s.includes("contract")) return "part_time";
  if (s.includes("full")) return "full_time";
  return undefined;
}

interface ProviderResult {
  name: string;
  /** True when the API already filtered by the query server-side. */
  prefiltered: boolean;
  candidates: RawJobCandidate[];
}

// ───────────────────────── aggregator providers ────────────────────────────

async function fetchAdzuna(q: ParsedQuery, limit: number, timeoutMs: number): Promise<RawJobCandidate[]> {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const country = (process.env.ADZUNA_COUNTRY || "us").toLowerCase();
  const params = new URLSearchParams({
    app_id: id, app_key: key, results_per_page: String(Math.min(limit * 2, 50)),
    what: q.what, "content-type": "application/json",
  });
  if (q.where) params.set("where", q.where);
  type Adz = { results?: Array<{ title?: string; company?: { display_name?: string }; location?: { display_name?: string }; description?: string; redirect_url?: string; contract_time?: string }> };
  const data = await fetchJson<Adz>(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`, timeoutMs);
  return (data.results ?? []).flatMap((j) => {
    if (!j.title || !j.redirect_url) return [];
    return [{
      title: j.title,
      company: j.company?.display_name?.trim() || "Company",
      url: j.redirect_url,
      source: "Adzuna",
      evidence: `${j.title}. ${cleanDescription(j.description ?? "")}`,
      location: j.location?.display_name?.trim() || (q.remote ? "Remote" : undefined),
      employmentType: mapEmployment(j.contract_time) ?? mapEmployment(j.title),
    }];
  });
}

async function fetchRemotive(q: ParsedQuery, limit: number, timeoutMs: number): Promise<RawJobCandidate[]> {
  const params = new URLSearchParams({ search: q.what, limit: String(Math.min(limit * 2, 40)) });
  type Rem = { jobs?: Array<{ title?: string; company_name?: string; candidate_required_location?: string; url?: string; description?: string; job_type?: string }> };
  const data = await fetchJson<Rem>(`https://remotive.com/api/remote-jobs?${params}`, timeoutMs);
  return (data.jobs ?? []).flatMap((j) => {
    if (!j.title || !j.url) return [];
    return [{
      title: j.title,
      company: j.company_name?.trim() || "Company",
      url: j.url,
      source: "Remotive",
      evidence: `${j.title}. ${cleanDescription(j.description ?? "")}`,
      location: j.candidate_required_location?.trim() || "Remote",
      employmentType: mapEmployment(j.job_type),
    }];
  });
}

/**
 * Map a query to a valid Muse category enum so finance/design/etc. surface.
 * Names must match the API's enum exactly (verified against the public API).
 */
function museCategory(q: ParsedQuery): string | undefined {
  // Match word stems (no trailing \b) so "investment"/"banking"/"analytics" hit.
  const s = `${q.what} ${q.terms.join(" ")}`.toLowerCase();
  if (/\b(invest|bank|financ|account|trading|hedge|equity)/.test(s)) return "Accounting and Finance";
  if (/\bdata\b|\banalyt|statistic/.test(s)) return "Data and Analytics";
  if (/software|engineer|developer|swe|backend|frontend|full[\s-]?stack|\bml\b|machine learning|\bai\b/.test(s)) return "Software Engineering";
  if (/product manager|product management/.test(s)) return "Product Management";
  if (/design|\bux\b|\bui\b/.test(s)) return "Design and UX";
  if (/market|growth/.test(s)) return "Marketing";
  if (/\bsales\b/.test(s)) return "Sales";
  return undefined;
}

/** The Muse expects its own "City, State" enum values for the location filter. */
const CITY_TO_MUSE: Record<string, string> = {
  "New York": "New York City, New York",
  "San Francisco": "San Francisco, California",
  "Los Angeles": "Los Angeles, California",
  "Seattle": "Seattle, Washington",
  "Boston": "Boston, Massachusetts",
  "Austin": "Austin, Texas",
  "Chicago": "Chicago, Illinois",
  "Washington": "Washington, District of Columbia",
};

type MusePage = { results?: Array<{ name?: string; type?: string; contents?: string; company?: { name?: string }; locations?: Array<{ name?: string }>; refs?: { landing_page?: string } }> };

async function fetchMuse(q: ParsedQuery, timeoutMs: number): Promise<RawJobCandidate[]> {
  const category = museCategory(q);
  const location = q.where ? (CITY_TO_MUSE[q.where] ?? q.where) : undefined;
  const base = (page: number) => {
    const params = new URLSearchParams({ page: String(page), descending: "true" });
    if (category) params.set("category", category);
    if (location) params.set("location", location);
    return `https://www.themuse.com/api/public/jobs?${params}`;
  };
  // Two pages for more depth; the second is best-effort.
  const pages = await Promise.all([0, 1].map((p) =>
    fetchJson<MusePage>(base(p), timeoutMs).catch(() => ({ results: [] } as MusePage))));
  return pages.flatMap((data) => (data.results ?? []).flatMap((j) => {
    const url = j.refs?.landing_page;
    if (!j.name || !url) return [];
    return [{
      title: j.name,
      company: j.company?.name?.trim() || "Company",
      url,
      source: "The Muse",
      evidence: `${j.name}. ${cleanDescription(j.contents ?? "")}`,
      location: j.locations?.map((l) => l.name).filter(Boolean).join("; ") || undefined,
      employmentType: mapEmployment(j.type),
    }];
  }));
}

// ───────────────────────── ATS board providers ─────────────────────────────

type Provider = "greenhouse" | "ashby" | "lever";
interface AtsSource { provider: Provider; token: string; company: string; startup?: boolean }

/** Curated open ATS boards — extra depth for tech queries, skipped otherwise. */
const COMPANIES: AtsSource[] = [
  { provider: "ashby", token: "anthropic", company: "Anthropic" },
  { provider: "ashby", token: "OpenAI", company: "OpenAI" },
  { provider: "ashby", token: "ramp", company: "Ramp", startup: true },
  { provider: "ashby", token: "linear", company: "Linear", startup: true },
  { provider: "greenhouse", token: "databricks", company: "Databricks" },
  { provider: "greenhouse", token: "airbnb", company: "Airbnb" },
  { provider: "greenhouse", token: "coinbase", company: "Coinbase" },
  { provider: "greenhouse", token: "figma", company: "Figma" },
  { provider: "greenhouse", token: "robinhood", company: "Robinhood" },
  { provider: "greenhouse", token: "discord", company: "Discord", startup: true },
  { provider: "greenhouse", token: "brex", company: "Brex", startup: true },
  { provider: "greenhouse", token: "stripe", company: "Stripe" },
];

export function planJobSources(query: string): AtsSource[] {
  const startupHeavy = /startup|yc\b|y combinator|founder|seed|early[\s-]?stage/i.test(query);
  return startupHeavy ? [...COMPANIES].sort((a, b) => Number(!!b.startup) - Number(!!a.startup)) : COMPANIES;
}

function atsUrl(source: AtsSource): string {
  switch (source.provider) {
    case "greenhouse": return `https://boards-api.greenhouse.io/v1/boards/${source.token}/jobs?content=true`;
    case "ashby": return `https://api.ashbyhq.com/posting-api/job-board/${source.token}?includeCompensation=false`;
    case "lever": return `https://api.lever.co/v0/postings/${source.token}?mode=json`;
  }
}

function parseAts(provider: Provider, body: unknown, source: AtsSource): RawJobCandidate[] {
  if (provider === "greenhouse") {
    const data = body as { jobs?: Array<{ title?: string; absolute_url?: string; location?: { name?: string }; content?: string }> };
    return (data.jobs ?? []).flatMap((j) => j.title && j.absolute_url ? [{
      title: j.title, company: source.company, url: j.absolute_url,
      source: `${source.company} (Greenhouse)`,
      evidence: `${j.title}. ${j.content ? cleanDescription(j.content) : ""}`,
      location: j.location?.name?.trim() || undefined,
    }] : []);
  }
  if (provider === "ashby") {
    const data = body as { jobs?: Array<{ title?: string; jobUrl?: string; location?: string; employmentType?: string; descriptionPlain?: string; isRemote?: boolean }> };
    return (data.jobs ?? []).flatMap((j) => j.title && j.jobUrl ? [{
      title: j.title, company: source.company, url: j.jobUrl,
      source: `${source.company} (Ashby)`,
      evidence: `${j.title}. ${j.employmentType ?? ""}. ${(j.descriptionPlain ?? "").slice(0, 3800)}`,
      location: j.location?.trim() || (j.isRemote ? "Remote" : undefined),
      employmentType: mapEmployment(j.employmentType),
    }] : []);
  }
  const data = body as Array<{ text?: string; hostedUrl?: string; categories?: { location?: string; commitment?: string }; descriptionPlain?: string }>;
  return (data ?? []).flatMap((j) => j.text && j.hostedUrl ? [{
    title: j.text, company: source.company, url: j.hostedUrl,
    source: `${source.company} (Lever)`,
    evidence: `${j.text}. ${j.categories?.commitment ?? ""}. ${(j.descriptionPlain ?? "").slice(0, 3800)}`,
    location: j.categories?.location?.trim() || undefined,
    employmentType: mapEmployment(j.categories?.commitment),
  }] : []);
}

async function fetchAtsBoards(query: string, timeoutMs: number): Promise<RawJobCandidate[]> {
  const sources = planJobSources(query);
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const body = await fetchJson<unknown>(atsUrl(source), timeoutMs);
      return parseAts(source.provider, body, source);
    } catch {
      return [] as RawJobCandidate[];
    }
  }));
  return results.flat();
}

// ───────────────────────────── relevance + run ─────────────────────────────

/** Quick relevance score so the most on-topic postings are digested first. */
export function relevanceScore(candidate: RawJobCandidate, terms: string[]): number {
  const title = candidate.title.toLowerCase();
  const hay = `${title} ${candidate.evidence}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 5;
    else if (hay.includes(t)) score += 2;
  }
  if (/\bintern|new ?grad|university|early career|entry[\s-]?level\b/.test(title)) score += 3;
  return score;
}

export interface JobSearchAgentInput {
  query?: string;
  limit?: number;
  timeoutMs?: number;
}

export interface JobSearchAgentOutput {
  candidates: RawJobCandidate[];
  steps: Array<{ agent: string; ok: boolean; summary: string }>;
}

export async function findJobs(input: JobSearchAgentInput): Promise<JobSearchAgentOutput> {
  const query = input.query?.trim() ?? "";
  const limit = Math.min(input.limit ?? 12, 30);
  const timeoutMs = input.timeoutMs ?? 6000;
  const q = parseQuery(query);
  const steps: JobSearchAgentOutput["steps"] = [];

  // Build the provider set from the query. Aggregators are query-filtered
  // server-side; ATS boards are only worth the calls for tech-leaning queries.
  // Adzuna (all industries) and The Muse (industry breadth) always run. Remotive
  // and the ATS boards are tech/remote-leaning, so they only run when the query
  // is — otherwise they inject irrelevant software roles into e.g. a finance search.
  const techLeaning = q.tech || !q.terms.length;
  // When a Muse category matched, its results are already topic-filtered, so we
  // trust them rather than re-gating on a literal keyword match.
  const museFiltered = !!museCategory(q);
  const tasks: Array<Promise<ProviderResult>> = [
    fetchAdzuna(q, limit, timeoutMs).then((c) => ({ name: "Adzuna", prefiltered: true, candidates: c })).catch(() => ({ name: "Adzuna", prefiltered: true, candidates: [] })),
    fetchMuse(q, timeoutMs).then((c) => ({ name: "The Muse", prefiltered: museFiltered, candidates: c })).catch(() => ({ name: "The Muse", prefiltered: museFiltered, candidates: [] })),
  ];
  if (techLeaning || q.remote) {
    tasks.push(fetchRemotive(q, limit, timeoutMs).then((c) => ({ name: "Remotive", prefiltered: true, candidates: c })).catch(() => ({ name: "Remotive", prefiltered: true, candidates: [] })));
  }
  if (techLeaning) {
    tasks.push(fetchAtsBoards(query, timeoutMs).then((c) => ({ name: "ATS boards", prefiltered: false, candidates: c })).catch(() => ({ name: "ATS boards", prefiltered: false, candidates: [] })));
  }

  const results = await Promise.all(tasks);
  const used = results.filter((r) => r.candidates.length > 0).map((r) => r.name);
  steps.push({
    agent: "job-source-planner",
    ok: true,
    summary: `Searched ${q.what ? `"${q.what}"` : "all roles"}${q.where ? ` near ${q.where}` : ""}${q.remote ? " (remote)" : ""} across ${results.length} provider(s).`,
  });

  // Pool, dedupe by URL, gate non-prefiltered sources by query relevance, rank.
  const seen = new Set<string>();
  const pooled: Array<{ candidate: RawJobCandidate; rel: number }> = [];
  for (const result of results) {
    for (const candidate of result.candidates) {
      const key = candidate.url.split("?")[0]!;
      if (seen.has(key)) continue;
      seen.add(key);
      const rel = relevanceScore(candidate, q.terms);
      if (!result.prefiltered && q.terms.length && rel === 0) continue;
      pooled.push({ candidate, rel: rel + (result.prefiltered ? 1 : 0) });
    }
  }
  pooled.sort((a, b) => b.rel - a.rel);
  const candidates = pooled.slice(0, limit * 2).map((p) => p.candidate);

  steps.push({
    agent: "job-search-agent",
    ok: candidates.length > 0,
    summary: candidates.length
      ? `Found ${candidates.length} relevant opening(s) via ${used.join(", ") || "no provider"}.`
      : "No matching openings from the configured providers.",
  });

  return { candidates, steps };
}

export const jobSearchAgent: Agent<JobSearchAgentInput, JobSearchAgentOutput> = {
  name: "job-search-agent",
  description: "Query-driven job discovery across industries via real job-search APIs (Adzuna/Remotive/The Muse) plus ATS boards for tech roles, relevance-ranked to the student's query.",
  status: "active",
  skills: ["job-search-api", "job-extract"],
  run: async (input: JobSearchAgentInput, _ctx: AgentContext) => findJobs(input),
};

registerAgent(jobSearchAgent);
