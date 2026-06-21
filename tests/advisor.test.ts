import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, type CourseRow, type SectionRow } from "../src/db/repo.ts";
import { advise } from "../src/agents/course-planner/advising-orchestrator.ts";
import { _resetProvider } from "../src/providers/index.ts";
import { listAgents } from "../src/agents/registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "src", "db", "schema.sql"), "utf8");

function addCourse(repo: Repo, number: string, title: string, days: string, start: number): void {
  const id = `compsci-${number.toLowerCase()}`;
  const course: CourseRow = {
    id, subject: "COMPSCI", number, title, units: 4, description: title,
    requirements_satisfied: title.includes("Algorithms") ? JSON.stringify(["algorithms"]) : null,
    terms_offered: JSON.stringify(["fall-2026"]), prerequisites: null, avg_gpa: 3.3, updated_at: null,
  };
  const section: SectionRow = {
    id: `${id}-fall`, course_id: id, term: "fall-2026", class_number: null,
    component: "LEC", instructor: null, days, start_min: start, end_min: start + 60,
    location: null, enroll_cap: 100, enrolled: 50, waitlist: 0, status: "open", updated_at: null,
  };
  repo.upsertCourse(course);
  repo.upsertSection(section);
}

test("course planner runs the complete deterministic pipeline", async () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  _resetProvider();
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  const repo = new Repo(db);
  try {
    const user = repo.upsertUserByGoogle({ id: "planner-user", google_sub: "dev:planner", email: "planner@example.com", name: "Planner" });
    repo.upsertProfile({
      user_id: user.id, college: null, major: "Economics", grad_year: 2027,
      interests: "[]", completed_courses: "[]", requirements_remaining: JSON.stringify(["algorithms"]),
      time_prefs: JSON.stringify({ earliest: "09:00", latest: "17:00", daysOff: [] }),
      workload_tolerance: "medium", min_prof_rating: null, updated_at: new Date().toISOString(),
    });
    addCourse(repo, "170", "Efficient Algorithms", "MWF", 600);
    addCourse(repo, "188", "Artificial Intelligence", "TuTh", 720);
    addCourse(repo, "189", "Machine Learning", "MWF", 840);

    const out = await advise(
      { userId: user.id, query: "Find open CS courses about algorithms with manageable workload" },
      { repo },
    );

    assert.equal(out.mode, "heuristic");
    assert.equal(out.constraints.subject, "COMPSCI");
    assert.equal(out.followUp, null);
    assert.equal(out.results[0]?.cand.course.number, "170");
    assert.equal(out.intent, "course_search");
    assert.ok(out.coverage.some(item => item.requirement === "algorithms"));
    assert.ok((out.compression?.afterTokens ?? 0) > 0);
    for (const agent of ["student-query-agent", "school-policy-agent", "planning-evaluator-agent"]) {
      assert.ok(out.steps.some(step => step.agent === agent && step.ok), agent);
    }
    assert.deepEqual(listAgents().map(agent => agent.name).sort(), [
      "planning-evaluator-agent", "school-policy-agent", "student-query-agent",
    ]);

    const policy = await advise({ userId: user.id, query: "What are my remaining degree requirements?" }, { repo });
    assert.equal(policy.intent, "policy_question");
    assert.equal(policy.results.length, 0);
    assert.deepEqual(policy.steps.map(step => step.agent), ["student-query-agent", "school-policy-agent"]);
    assert.match(policy.summary, /algorithms/i);
  } finally {
    db.close();
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
    _resetProvider();
  }
});
