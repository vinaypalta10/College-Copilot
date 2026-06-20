import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCourse, estimateWorkload, type CourseCandidate } from "../src/scorer/courseScore.ts";
import { buildSchedule, slotsConflict, parseDayCodes, findConflicts, type SchedulableSection } from "../src/scorer/scheduleBuilder.ts";

function course(over: Partial<CourseCandidate["course"]> = {}): CourseCandidate["course"] {
  return {
    id: "compsci-170", subject: "COMPSCI", number: "170", title: "Efficient Algorithms",
    units: 4, description: "algorithms and complexity", requirements_satisfied: null,
    terms_offered: null, prerequisites: null, avg_gpa: 3.3, updated_at: null, ...over,
  };
}

test("scoreCourse: completed course is demoted to 0", () => {
  const r = scoreCourse({ course: course() }, { completedCourses: ["COMPSCI 170"] });
  assert.equal(r.score, 0);
  assert.equal(r.flags.completed, true);
});

test("scoreCourse: requirement match boosts and is flagged", () => {
  const r = scoreCourse({ course: course() }, { requirementsRemaining: ["CS upper division algorithms"] });
  assert.equal(r.flags.requirementMatch, true);
  assert.ok(r.score > 50);
});

test("scoreCourse: professor below min rating is penalized", () => {
  const cand: CourseCandidate = {
    course: course(),
    instructor: { id: "x", name: "X", rmp_rating: 2.0, rmp_difficulty: 4, rmp_would_take_again: 20, rmp_num_ratings: 10, avg_gpa: null, grade_distribution: null, fetched_at: null },
  };
  const r = scoreCourse(cand, { minProfRating: 3.5 });
  assert.equal(r.flags.belowMinRating, true);
});

test("scoreCourse: time outside preferred hours is a conflict", () => {
  const cand: CourseCandidate = {
    course: course(),
    section: { id: "s", course_id: "compsci-170", term: "fall-2026", class_number: null, component: "LEC", instructor: "X", days: "MWF", start_min: 8 * 60, end_min: 9 * 60, location: null, enroll_cap: null, enrolled: null, waitlist: null, status: "open", updated_at: null },
  };
  const r = scoreCourse(cand, { timePrefs: { earliest: "10:00", latest: "16:00" } });
  assert.equal(r.flags.timeConflict, true);
});

test("estimateWorkload: high units + low GPA => heavier", () => {
  const light = estimateWorkload({ course: course({ units: 2, avg_gpa: 3.9 }) });
  const heavy = estimateWorkload({ course: course({ units: 5, avg_gpa: 2.8 }) });
  assert.equal(light.estimate, "light");
  assert.equal(heavy.estimate, "heavy");
});

test("parseDayCodes splits two-letter days correctly", () => {
  assert.deepEqual(parseDayCodes("TuTh"), ["Tu", "Th"]);
  assert.deepEqual(parseDayCodes("MWF"), ["M", "W", "F"]);
});

test("slotsConflict: overlap on shared day", () => {
  const a = { days: ["M", "W"], startMin: 600, endMin: 660 };
  const b = { days: ["W", "F"], startMin: 630, endMin: 700 };
  const c = { days: ["Tu"], startMin: 600, endMin: 660 };
  assert.equal(slotsConflict(a, b), true);
  assert.equal(slotsConflict(a, c), false);
});

function sec(id: string, courseId: string, days: string[], start: number, end: number, fit = 50, units = 4): SchedulableSection {
  return { id, courseId, label: id, units, fitScore: fit, slot: { days, startMin: start, endMin: end } };
}

test("buildSchedule: skips conflicts and respects unit cap", () => {
  const a = sec("A", "ca", ["M", "W"], 600, 660, 90);
  const b = sec("B", "cb", ["M", "W"], 630, 690, 80);  // conflicts with A
  const c = sec("C", "cc", ["Tu", "Th"], 600, 660, 70);
  const r = buildSchedule([a, b, c], 18);
  assert.deepEqual(r.chosen.map(s => s.id), ["A", "C"]);
  assert.equal(r.totalUnits, 8);
  assert.ok(r.skipped.some(s => s.section.id === "B"));
});

test("buildSchedule: one section per course", () => {
  const a = sec("A1", "shared", ["M"], 600, 660, 90);
  const a2 = sec("A2", "shared", ["F"], 600, 660, 80);
  const r = buildSchedule([a, a2]);
  assert.equal(r.chosen.length, 1);
});

test("findConflicts returns overlapping pairs", () => {
  const a = sec("A", "ca", ["M"], 600, 660);
  const b = sec("B", "cb", ["M"], 630, 700);
  assert.equal(findConflicts([a, b]).length, 1);
});
