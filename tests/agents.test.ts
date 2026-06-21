import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedCourse } from "../src/scorer/candidates.ts";
import { checkRequirements } from "../src/agents/specialists/requirement-checker.ts";
import { estimateScheduleWorkload } from "../src/agents/specialists/workload-estimator.ts";
import { buildFromCandidates } from "../src/agents/specialists/schedule-builder.ts";
import { heuristicParse, mergePrefs } from "../src/agents/parseQuery.ts";
import { scoreCourse } from "../src/scorer/courseScore.ts";
import { rankCatalog } from "../src/scorer/candidates.ts";
import type { Catalog } from "../src/db/courseCache.ts";

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
  assert.equal(c.topicQuery, null);
});

test("heuristicParse extracts lower division History and excludes Friday", () => {
  const c = heuristicParse("give me lower division history courses not on Fridays");
  assert.equal(c.subject, "HISTORY");
  assert.equal(c.minCourseNumber, 1);
  assert.equal(c.maxCourseNumber, 99);
  assert.deepEqual(c.daysOff, ["F"]);
  assert.equal(c.topicQuery, null);
});

test("heuristicParse treats listed meeting days as allowed days and keeps the academic topic", () => {
  const c = heuristicParse("upper div math real analysis on Monday Tuesday Wednesday");
  assert.equal(c.subject, "MATH");
  assert.equal(c.minCourseNumber, 100);
  assert.equal(c.maxCourseNumber, 199);
  assert.deepEqual(c.allowedDays, ["M", "Tu", "W"]);
  assert.equal(c.topicQuery, "real analysis");
});

test("mergePrefs overlays constraints onto base profile", () => {
  const base = { interests: ["theory"], requirementsRemaining: ["upper div"], minProfRating: 3.0, workloadTolerance: "medium" as const, timePrefs: { earliest: "09:00", daysOff: ["W"] } };
  const merged = mergePrefs(base, { interests: ["ml"], minProfRating: 4.0, latest: "15:00", daysOff: ["F"] });
  assert.deepEqual(merged.interests, ["theory", "ml"]);
  assert.equal(merged.minProfRating, 4.0);
  assert.equal(merged.timePrefs?.earliest, "09:00");
  assert.equal(merged.timePrefs?.latest, "15:00");
  assert.deepEqual(merged.timePrefs?.daysOff, ["W", "F"]);
});

test("explicitly allowed days override conflicting saved days-off preferences", () => {
  const merged = mergePrefs({ timePrefs: { daysOff: ["W", "F"] } }, { allowedDays: ["M", "Tu", "W"] });
  assert.deepEqual(merged.timePrefs?.daysOff, ["F"]);
});

test("rankCatalog hard-filters lower-division History courses and Friday meetings", () => {
  const candidates = [
    rc("HISTORY", "7A", { title: "United States History", days: "TuTh", start: 600, end: 660 }),
    rc("HISTORY", "30", { title: "Early Global History", days: "MWF", start: 600, end: 660 }),
    rc("HISTORY", "101", { title: "Upper Division Seminar", days: "TuTh", start: 600, end: 660 }),
    rc("ENGLISH", "45A", { title: "Literature", days: "TuTh", start: 600, end: 660 }),
  ];
  const catalog: Catalog = {
    term: "fall-2026",
    courses: candidates.map(item => item.cand.course),
    sectionsByCourse: Object.fromEntries(candidates.map(item => [item.cand.course.id, item.cand.section ? [item.cand.section] : []])),
    builtAt: new Date().toISOString(),
  };
  const ranked = rankCatalog(catalog, {}, {
    subject: "HISTORY",
    minCourseNumber: 1,
    maxCourseNumber: 99,
    excludedDays: ["F"],
  }, () => undefined);
  assert.deepEqual(ranked.map(item => item.cand.course.number), ["7A"]);
});

test("rankCatalog uses topic relevance instead of returning unrelated Math courses", () => {
  const analysis = rc("MATH", "104", { title: "Introduction to Analysis", days: "TuTh" });
  analysis.cand.course.description = "The real number system, sequences, limits, and continuous functions.";
  const economics = rc("MATH", "C103", { title: "Introduction to Mathematical Economics", days: "TuTh" });
  economics.cand.course.description = "Applications of mathematics to economic theory.";
  const catalog: Catalog = {
    term: "fall-2026",
    courses: [economics.cand.course, analysis.cand.course],
    sectionsByCourse: {
      [analysis.cand.course.id]: [analysis.cand.section!],
      [economics.cand.course.id]: [economics.cand.section!],
    },
    builtAt: new Date().toISOString(),
  };
  const ranked = rankCatalog(catalog, {}, {
    subject: "MATH",
    minCourseNumber: 100,
    maxCourseNumber: 199,
    topicQuery: "real analysis",
  }, () => undefined);
  assert.deepEqual(ranked.map(item => item.cand.course.number), ["104"]);
});
