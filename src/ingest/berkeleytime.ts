/**
 * Berkeleytime ingestion adapter.
 *
 * Berkeleytime exposes a public GraphQL API at /api/graphql (sourced from
 * Berkeley's CalAnswers + SIS). We use it as the primary catalog source —
 * no API key required.
 *
 * Pipeline:
 *   1. catalog(year, semester)  -> lean list of every class in the term
 *   2. filter to a subject allowlist, dedupe by (subject, courseNumber)
 *   3. course(subject, number)  -> rich detail (sections, meetings, grades)
 *
 * `Semester` is a GraphQL enum, so it is passed via variables (where a JSON
 * string is accepted) rather than inlined.
 */

import type { CourseRow, SectionRow } from "../db/repo.ts";

const BASE = process.env.BERKELEYTIME_BASE_URL || "https://berkeleytime.com";
const ENDPOINT = `${BASE}/api/graphql`;

const SEMESTERS = ["Spring", "Summer", "Fall", "Winter"] as const;
type Semester = typeof SEMESTERS[number];

export interface ParsedTerm {
  year: number;
  semester: Semester;
  term: string; // canonical "fall-2026"
}

/** "fall-2026" | "Fall 2026" -> { year, semester }. */
export function parseTerm(input: string): ParsedTerm {
  const m = input.trim().toLowerCase().match(/([a-z]+)[\s-]+(\d{4})/);
  if (!m || !m[1] || !m[2]) throw new Error(`Cannot parse term "${input}". Use e.g. "fall-2026".`);
  const sem = (m[1].charAt(0).toUpperCase() + m[1].slice(1)) as Semester;
  if (!SEMESTERS.includes(sem)) throw new Error(`Unknown semester "${m[1]}".`);
  const year = Number(m[2]);
  return { year, semester: sem, term: `${sem.toLowerCase()}-${year}` };
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Berkeleytime GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`Berkeleytime GraphQL error: ${json.errors[0]?.message}`);
  if (!json.data) throw new Error("Berkeleytime GraphQL returned no data");
  return json.data;
}

interface CatalogLite { subject: string; courseNumber: string }

/** Distinct (subject, courseNumber) pairs for the term, filtered to `subjects`. */
export async function listCourseKeys(term: ParsedTerm, subjects?: string[]): Promise<CatalogLite[]> {
  const data = await gql<{ catalog: Array<{ subject: string; courseNumber: string }> }>(
    `query($y:Int!,$s:Semester!){ catalog(year:$y, semester:$s){ subject courseNumber } }`,
    { y: term.year, s: term.semester },
  );
  const allow = subjects?.length ? new Set(subjects.map(s => s.toUpperCase())) : null;
  const seen = new Set<string>();
  const out: CatalogLite[] = [];
  for (const row of data.catalog) {
    if (allow && !allow.has(row.subject?.toUpperCase())) continue;
    const key = `${row.subject}|${row.courseNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subject: row.subject, courseNumber: row.courseNumber });
  }
  return out;
}

// Berkeleytime Meeting.days is a 7-element boolean array, Monday-first.
const DAY_CODES = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

export function daysToCode(days: Array<boolean | null> | null | undefined): string {
  if (!days) return "";
  return days.map((on, i) => (on ? DAY_CODES[i] : "")).join("");
}

/** "15:30:00" -> minutes since midnight (null when absent/async). */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m || !m[1] || !m[2]) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function courseId(subject: string, number: string): string {
  return `${subject}-${number}`.toLowerCase().replace(/\s+/g, "");
}

function sectionId(subject: string, number: string, term: string, classNumber: string, component: string): string {
  return `${courseId(subject, number)}-${term}-${classNumber || component || "main"}`.toLowerCase();
}

interface CourseDetail {
  course: CourseRow;
  sections: SectionRow[];
  instructorNames: string[];
}

const COURSE_QUERY = `
query($subject:String!, $number:CourseNumber!){
  course(subject:$subject, number:$number){
    subject number title requirements description typicallyOffered
    gradeDistribution { average }
    mostRecentClass {
      title description unitsMax unitsMin
      requirementDesignation { code description }
      year semester
      primarySection {
        component instructionMode online
        meetings { days startTime endTime location instructors { familyName givenName } }
        enrollment { latest { status enrolledCount maxEnroll waitlistedCount } }
      }
    }
  }
}`;

/** Fetch + normalize one course into rows ready for upsert. Returns null if absent. */
export async function fetchCourseDetail(subject: string, number: string, term: ParsedTerm): Promise<CourseDetail | null> {
  const data = await gql<{ course: any }>(COURSE_QUERY, { subject, number });
  const c = data.course;
  if (!c) return null;

  const cls = c.mostRecentClass;
  const sec = cls?.primarySection;
  const units = cls?.unitsMax ?? cls?.unitsMin ?? null;
  const reqDesignation: string[] = [];
  const rd = cls?.requirementDesignation;
  if (rd?.description) reqDesignation.push(rd.description);

  const id = courseId(subject, number);
  const now = new Date().toISOString();

  const course: CourseRow = {
    id,
    subject,
    number,
    title: c.title ?? cls?.title ?? `${subject} ${number}`,
    units,
    description: c.description ?? cls?.description ?? null,
    requirements_satisfied: reqDesignation.length ? JSON.stringify(reqDesignation) : null,
    terms_offered: c.typicallyOffered ? JSON.stringify([c.typicallyOffered]) : null,
    prerequisites: c.requirements ?? null,
    avg_gpa: c.gradeDistribution?.average ?? null,
    updated_at: now,
  };

  const sections: SectionRow[] = [];
  const instructorNames = new Set<string>();
  if (sec) {
    const meeting = (sec.meetings ?? [])[0] ?? null;
    const instr = (meeting?.instructors ?? [])
      .map((p: any) => [p.givenName, p.familyName].filter(Boolean).join(" ").trim())
      .filter(Boolean);
    instr.forEach((n: string) => instructorNames.add(n));
    const latest = sec.enrollment?.latest;
    const statusMap: Record<string, string> = { O: "open", W: "waitlist", C: "closed" };
    const classNumber = ""; // primarySection has no separate CCN in this projection
    sections.push({
      id: sectionId(subject, number, term.term, classNumber, sec.component ?? "LEC"),
      course_id: id,
      term: term.term,
      class_number: null,
      component: sec.component ?? null,
      instructor: instr[0] ?? null,
      days: meeting ? daysToCode(meeting.days) : null,
      start_min: timeToMinutes(meeting?.startTime),
      end_min: timeToMinutes(meeting?.endTime),
      location: meeting?.location ?? (sec.online ? "Online" : null),
      enroll_cap: latest?.maxEnroll ?? null,
      enrolled: latest?.enrolledCount ?? null,
      waitlist: latest?.waitlistedCount ?? null,
      status: latest?.status ? (statusMap[latest.status] ?? latest.status) : null,
      updated_at: now,
    });
  }

  return { course, sections, instructorNames: [...instructorNames] };
}
