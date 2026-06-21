/**
 * Course fit scoring — pure, deterministic, explainable.
 *
 * Produces a 0-100 fit score plus human-readable reasons ("why it matches")
 * by blending: requirement match, interest match, professor rating,
 * workload vs. tolerance, and time-of-day fit. No network, no LLM — easy to
 * unit-test. The LLM layer (course-advisor agent) sits on top of this.
 */

import type { CourseRow, SectionRow, InstructorRow } from "../db/repo.ts";
import { subjectsForMajor } from "./majorSubjects.ts";

export interface StudentPrefs {
  major?: string | null;
  interests?: string[];                 // research/opportunity ranking only
  completedCourses?: string[];          // e.g. ["COMPSCI 61A"]
  requirementsRemaining?: string[];     // free-text labels
  timePrefs?: { earliest?: string; latest?: string; daysOff?: string[] };
  workloadTolerance?: "light" | "medium" | "heavy" | null;
  minProfRating?: number | null;
}

export interface CourseCandidate {
  course: CourseRow;
  section?: SectionRow;
  instructor?: InstructorRow;
}

export interface FitResult {
  score: number;
  reasons: string[];
  flags: { majorMatch: boolean; requirementMatch: boolean; timeConflict: boolean; belowMinRating: boolean; completed: boolean };
  workload: { estimate: "light" | "medium" | "heavy"; rationale: string };
}

const DAY_ORDER = ["M", "Tu", "W", "Th", "F", "Sa", "Su"];

function parseDays(code: string | null): string[] {
  if (!code) return [];
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (DAY_ORDER.includes(two)) { out.push(two); i += 2; }
    else { out.push(code[i]!); i += 1; }
  }
  return out;
}

function hhmmToMin(s?: string): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m && m[1] && m[2] ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

/** Estimate workload from units + course average GPA + professor difficulty. */
export function estimateWorkload(c: CourseCandidate): FitResult["workload"] {
  const units = c.course.units ?? 3;
  const gpa = c.course.avg_gpa;
  const difficulty = c.instructor?.rmp_difficulty ?? null;
  // Higher units + lower average GPA + higher difficulty => heavier.
  let load = units; // 1-5ish
  if (gpa != null) load += (3.5 - gpa) * 2;          // low avg GPA pushes load up
  if (difficulty != null) load += (difficulty - 3);  // RMP difficulty 1-5
  const bucket = load >= 6 ? "heavy" : load >= 4 ? "medium" : "light";
  const bits = [`${units} units`];
  if (gpa != null) bits.push(`avg GPA ${gpa.toFixed(2)}`);
  if (difficulty != null) bits.push(`RMP difficulty ${difficulty.toFixed(1)}/5`);
  return { estimate: bucket, rationale: bits.join(", ") };
}

export function scoreCourse(c: CourseCandidate, prefs: StudentPrefs): FitResult {
  const reasons: string[] = [];
  const flags = { majorMatch: false, requirementMatch: false, timeConflict: false, belowMinRating: false, completed: false };
  let score = 50;

  const courseLabel = `${c.course.subject} ${c.course.number}`;
  const haystack = norm(`${courseLabel} ${c.course.title} ${c.course.description ?? ""} ${c.course.requirements_satisfied ?? ""}`);

  // Already completed -> hard demote.
  if ((prefs.completedCourses ?? []).some(cc => norm(cc) === norm(courseLabel))) {
    flags.completed = true;
    return { score: 0, reasons: ["You've already completed this course."], flags, workload: estimateWorkload(c) };
  }

  // Major match provides a broad program-level prior. Degree requirements,
  // supplied separately below, remain the strongest academic signal.
  const majorSubjects = subjectsForMajor(prefs.major);
  const majorSubjectIndex = majorSubjects.indexOf(c.course.subject.toUpperCase());
  if (majorSubjectIndex !== -1) {
    flags.majorMatch = true;
    score += majorSubjectIndex === 0 ? 20 : 12;
    reasons.push(majorSubjectIndex === 0
      ? `Core subject for your ${prefs.major} major.`
      : `Related to your ${prefs.major} major.`);
  }

  // Requirement match.
  for (const req of prefs.requirementsRemaining ?? []) {
    const tokens = norm(req).split(/[^A-Z0-9]+/).filter(t => t.length > 2);
    const hit = tokens.some(t => haystack.includes(t)) ||
      (c.course.requirements_satisfied ?? "").toUpperCase().includes(norm(req));
    if (hit) {
      flags.requirementMatch = true;
      score += 26;
      reasons.push(`Helps satisfy "${req}".`);
      break;
    }
  }

  // Professor rating.
  const rating = c.instructor?.rmp_rating ?? null;
  if (rating != null) {
    score += Math.round((rating - 3) * 6); // ±12
    if (prefs.minProfRating != null && rating < prefs.minProfRating) {
      flags.belowMinRating = true;
      score -= 25;
      reasons.push(`Professor rating ${rating.toFixed(1)} is below your ${prefs.minProfRating} minimum.`);
    } else if (rating >= 4) {
      reasons.push(`Well-rated professor (${rating.toFixed(1)}/5 on RateMyProfessors).`);
    }
  }

  // Workload vs tolerance.
  const workload = estimateWorkload(c);
  const tol = prefs.workloadTolerance ?? "medium";
  const rank = { light: 1, medium: 2, heavy: 3 } as const;
  if (rank[workload.estimate] > rank[tol]) {
    score -= 12;
    reasons.push(`Heavier workload (${workload.estimate}) than your ${tol} preference.`);
  } else if (workload.estimate === "light" && tol !== "heavy") {
    score += 4;
    reasons.push(`Manageable workload (${workload.rationale}).`);
  }

  // Time-of-day fit.
  const tp = prefs.timePrefs ?? {};
  if (c.section && c.section.start_min != null) {
    const earliest = hhmmToMin(tp.earliest);
    const latest = hhmmToMin(tp.latest);
    const days = parseDays(c.section.days);
    const offDay = (tp.daysOff ?? []).some(d => days.includes(norm(d) === "TU" ? "Tu" : d as string));
    const tooEarly = earliest != null && c.section.start_min < earliest;
    const tooLate = latest != null && c.section.end_min != null && c.section.end_min > latest;
    if (offDay || tooEarly || tooLate) {
      flags.timeConflict = true;
      score -= 18;
      reasons.push(offDay ? "Meets on a day you wanted off." : "Meeting time is outside your preferred hours.");
    } else if (earliest != null || latest != null) {
      score += 6;
      reasons.push("Fits your preferred class hours.");
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push("General fit for your profile.");
  return { score, reasons, flags, workload };
}
