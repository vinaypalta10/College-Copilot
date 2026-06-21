import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedCourse } from "../src/scorer/candidates.ts";
import { checkRequirements } from "../src/agents/course-planner/specialists/requirement-checker.ts";
import { estimateScheduleWorkload } from "../src/agents/course-planner/specialists/workload-estimator.ts";
import { buildFromCandidates } from "../src/agents/course-planner/specialists/schedule-builder.ts";
import { heuristicParse, mergePrefs } from "../src/agents/course-planner/parseQuery.ts";
import { scoreCourse } from "../src/scorer/courseScore.ts";

function rc(subject: string, number: string, opts: { units?: number; avgGpa?: number; days?: string; start?: number; end?: number; title?: string } = {}): RankedCourse {
  const course = {
    id: `${subject}-${number}`.toLowerCase(), subject, number, title: opts.title ?? "Course",
    units: opts.units ?? 4, description: "", requirements_satisfied: null, terms_offered: null,
    prerequisites: null, avg_gpa: opts.avgGpa ?? 3.3, updated_at: null,
  };
  const section = opts.days ? {
    id: `${subject}-${number}-sec`.toLowerCase(), course_id: course.id, term: "fall-2026", class_number: null,
    component: "LEC", instructor: "X", days: opts.days, start_min: opts.start ?? null, end_min: opts.end ?? null,
    location: null, enroll_cap: null, enrolled: null, waitlist: null, status: "open", updated_at: null,
  } : undefined;
  const cand = { course, section };
  return { cand, fit: scoreCourse(cand, {}) };
}

test("requirement-checker maps courses to requirements and reports uncovered", () => {
  const cands = [rc("COMPSCI", "170", { title: "Efficient Algorithms" }), rc("DATA", "100", { title: "Principles of Data Science" })];
  const out = checkRequirements({ candidates: cands, requirementsRemaining: ["algorithms", "Breadth: Arts"] });
  assert.ok(out.coverage.some(c => c.requirement === "algorithms" && c.courses.includes("COMPSCI 170")));
  assert.deepEqual(out.uncovered, ["Breadth: Arts"]);
});

test("workload-estimator flags a heavy semester", () => {
  const heavy = [rc("A", "1", { units: 5, avgGpa: 2.7 }), rc("B", "2", { units: 5, avgGpa: 2.8 }), rc("C", "3", { units: 5, avgGpa: 2.9 })];
  const out = estimateScheduleWorkload({ schedule: heavy });
  assert.equal(out.balance, "heavy");
  assert.ok(out.totalUnits >= 15);
});

test("schedule-builder assembles conflict-free set from candidates", () => {
  const a = rc("CS", "61A", { days: "MWF", start: 600, end: 660 });
  const b = rc("CS", "61B", { days: "MWF", start: 630, end: 690 }); // conflicts with a
  const c = rc("CS", "70", { days: "TuTh", start: 600, end: 660 });
  const out = buildFromCandidates({ candidates: [a, b, c], maxUnits: 18 });
  const labels = out.chosen.map(rc => `${rc.cand.course.subject} ${rc.cand.course.number}`);
  assert.ok(labels.includes("CS 61A"));
  assert.ok(labels.includes("CS 70"));
  assert.ok(!labels.includes("CS 61B"));
});

test("heuristicParse extracts subject, time, workload, rating, daysOff", () => {
  const c = heuristicParse("CS classes in the morning, manageable workload, nothing below 3.5, no friday");
  assert.equal(c.subject, "COMPSCI");
  assert.equal(c.latest, "12:00");
  assert.equal(c.workloadTolerance, "light");
  assert.equal(c.minProfRating, 3.5);
  assert.deepEqual(c.daysOff, ["F"]);
});

test("mergePrefs overlays constraints onto base profile", () => {
  const base = { interests: ["theory"], requirementsRemaining: ["upper div"], minProfRating: 3.0, workloadTolerance: "medium" as const, timePrefs: { earliest: "09:00" } };
  const merged = mergePrefs(base, { interests: ["ml"], minProfRating: 4.0, latest: "15:00" });
  assert.deepEqual(merged.interests, ["theory", "ml"]);
  assert.equal(merged.minProfRating, 4.0);
  assert.equal(merged.timePrefs?.earliest, "09:00");
  assert.equal(merged.timePrefs?.latest, "15:00");
});
