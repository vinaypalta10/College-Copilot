import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedCourse } from "../src/scorer/candidates.ts";
import { checkRequirements, reviewSchoolPolicy } from "../src/agents/course-planner/school-policy-agent.ts";
import { classifyIntent, followUpFor, heuristicParse, mergePrefs } from "../src/agents/course-planner/student-query-agent.ts";
import { scoreCourse } from "../src/scorer/courseScore.ts";
import { courseMatchesRequirement } from "../src/scorer/requirements.ts";
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

test("school-policy coverage maps courses to requirements and reports uncovered", () => {
  const cands = [rc("COMPSCI", "170", { title: "Efficient Algorithms" }), rc("DATA", "100", { title: "Principles of Data Science" })];
  const out = checkRequirements(cands, ["algorithms", "Breadth: Arts"]);
  assert.ok(out.coverage.some(c => c.requirement === "algorithms" && c.courses.includes("COMPSCI 170")));
  assert.deepEqual(out.uncovered, ["Breadth: Arts"]);
});

test("upper-division requirements do not match lower-division descriptions", () => {
  assert.equal(courseMatchesRequirement(rc("COMPSCI", "39", { title: "Lower Division Seminar" }).cand.course, "CS upper division"), false);
  assert.equal(courseMatchesRequirement(rc("COMPSCI", "170", { title: "Algorithms" }).cand.course, "CS upper division"), true);
});

test("school-policy agent keeps policy claims conservative", () => {
  const policy = reviewSchoolPolicy({
    prefs: { major: "Computer Science", requirementsRemaining: ["CS upper division"] },
    constraints: { targetMajor: "Data Science" },
    baseMajor: "Computer Science",
    query: "Can I switch to Data Science?",
  });
  assert.equal(policy.level, "undergraduate");
  assert.match(policy.warnings.join(" "), /not an official Berkeley degree audit/i);
  assert.match(policy.warnings.join(" "), /does not verify change-of-major eligibility/i);
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
  const base = { interests: ["theory"], requirementsRemaining: ["upper div"], minProfRating: 3.0, workloadTolerance: "medium" as const, timePrefs: { earliest: "09:00" } };
  const merged = mergePrefs(base, { interests: ["ml"], minProfRating: 4.0, latest: "15:00" });
  assert.deepEqual(merged.interests, ["theory", "ml"]);
  assert.equal(merged.minProfRating, 4.0);
  assert.equal(merged.timePrefs?.earliest, "09:00");
  assert.equal(merged.timePrefs?.latest, "15:00");
});

test("heuristicParse recognizes a major-transition goal", () => {
  const c = heuristicParse("I want to switch to CS");
  assert.equal(c.subject, "COMPSCI");
  assert.equal(c.targetMajor, "Computer Science");
});

test("mergePrefs plans against a target major without mutating saved profile input", () => {
  const base = { major: "Economics", requirementsRemaining: [] };
  const merged = mergePrefs(base, { targetMajor: "Computer Science" });
  assert.equal(merged.major, "Computer Science");
  assert.equal(base.major, "Economics");
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

test("followUpFor asks for academic direction only when profile and query lack it", () => {
  assert.match(followUpFor("help me choose", {}, {}) ?? "", /subject|major|requirement/i);
  assert.equal(followUpFor("help me choose", { major: "Data Science" }, {}), null);
});

test("heuristicParse extracts deterministic topic keywords", () => {
  const c = heuristicParse("Find machine learning and computer vision courses");
  assert.deepEqual(c.keywords, ["machine learning", "computer vision"]);
  assert.equal(followUpFor("Find machine learning courses", {}, c), null);
});

test("student-query agent separates policy questions from course discovery", () => {
  assert.equal(classifyIntent("What are my remaining degree requirements?"), "policy_question");
  assert.equal(classifyIntent("Can I take CS 170 without CS 70?"), "policy_question");
  assert.equal(classifyIntent("Find machine learning courses with good professors"), "course_search");
  assert.equal(classifyIntent("Which courses satisfy my breadth requirement?"), "course_search");
});
