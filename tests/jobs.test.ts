import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicDigest } from "../src/agents/industry-jobs/jd-digest-agent.ts";
import {
  classifyEmployment,
  extractLocation,
  extractDeadline,
  normalizeJob,
} from "../src/agents/industry-jobs/job-normalizer-agent.ts";
import { buildResumePrompt } from "../src/agents/industry-jobs/resume-prompt-agent.ts";
import { buildNetworkingLeads } from "../src/agents/industry-jobs/networking-agent.ts";
import { scoreJob } from "../src/agents/industry-jobs/jobs-orchestrator.ts";
import { planJobSources, relevanceScore, parseQuery } from "../src/agents/industry-jobs/job-search-agent.ts";

test("heuristicDigest pulls skills and splits preferred from required", () => {
  const d = heuristicDigest(
    "Software Engineering Intern. You will build services in Python and React. Required: SQL. " +
    "Experience with Kubernetes is preferred and a plus. Pursuing a Bachelor degree in Computer Science.",
  );
  assert.ok(d.requiredSkills.includes("python"));
  assert.ok(d.requiredSkills.includes("sql"));
  assert.ok(d.preferredSkills.includes("kubernetes"));
  assert.ok(d.responsibilities.some(r => /build services/i.test(r)));
  assert.ok(d.qualifications.some(q => /bachelor/i.test(q)));
  assert.ok(d.keywords.length > 0);
});

test("classifyEmployment distinguishes role types in priority order", () => {
  assert.equal(classifyEmployment("Summer 2026 Software Engineering Internship"), "internship");
  assert.equal(classifyEmployment("New Grad Software Engineer"), "new_grad");
  assert.equal(classifyEmployment("Part-time Data Analyst"), "part_time");
  assert.equal(classifyEmployment("Senior Backend Engineer"), "full_time");
});

test("extractLocation finds remote, city/state, and known hubs", () => {
  assert.equal(extractLocation("This role is fully remote."), "Remote");
  assert.equal(extractLocation("Based in Austin, TX with travel."), "Austin, TX");
  assert.equal(extractLocation("Join us in San Francisco."), "San Francisco");
  assert.equal(extractLocation("No location info here."), "Not specified");
});

test("extractDeadline parses explicit application deadlines", () => {
  assert.equal(extractDeadline("Apply by 2026-07-15 to be considered."), "2026-07-15");
  assert.equal(extractDeadline("No deadline stated"), undefined);
});

test("normalizeJob assembles a complete NormalizedJob from candidate + digest", () => {
  const job = normalizeJob({
    candidate: {
      title: "Machine Learning Intern",
      company: "Anthropic",
      url: "https://example.com/job/1",
      source: "Anthropic careers",
      evidence: "ML internship in San Francisco, CA. Apply by 2026-08-01. Build models in Python.",
    },
    digest: {
      requiredSkills: ["python"],
      preferredSkills: ["pytorch"],
      responsibilities: ["Build models"],
      qualifications: ["Pursuing a CS degree"],
      keywords: ["python", "pytorch"],
    },
  });
  assert.equal(job.employmentType, "internship");
  assert.equal(job.company, "Anthropic");
  assert.equal(job.location, "San Francisco, CA");
  assert.equal(job.applicationDeadline, "2026-08-01");
  assert.deepEqual(job.requiredSkills, ["python"]);
  assert.equal(job.url, "https://example.com/job/1");
});

test("scoreJob rewards interest and query overlap and stays in range", () => {
  const job = normalizeJob({
    candidate: { title: "ML Intern", company: "X", url: "u", source: "s", evidence: "" },
    digest: { requiredSkills: ["python"], preferredSkills: [], responsibilities: [], qualifications: [], keywords: ["machine learning"] },
  });
  const hit = scoreJob(job, ["machine learning"], { interests: ["machine learning"] }, ["python"]);
  const miss = scoreJob(job, ["machine learning"], { interests: ["accounting"] }, []);
  assert.ok(hit.score > miss.score);
  assert.ok(hit.score <= 100 && miss.score >= 0);
  assert.ok(hit.reasons.length > 0);
});

test("buildResumePrompt embeds the role and asks for a resume, sending nothing", () => {
  const prompt = buildResumePrompt({
    job: {
      title: "Data Intern", company: "Acme", location: "Remote", url: "u",
      employmentType: "internship", source: "s",
      requiredSkills: ["sql"], preferredSkills: [], responsibilities: ["analyze data"], qualifications: [],
    },
    prefs: { major: "Data Science", interests: ["analytics"] },
  });
  assert.match(prompt, /Data Intern/);
  assert.match(prompt, /Acme/);
  assert.match(prompt, /sql/);
  assert.match(prompt, /paste your resume here/i);
});

test("networking agent only produces manual-click search links, never sends", () => {
  const result = buildNetworkingLeads({
    job: { id: "job_1", title: "SWE Intern", company: "Anthropic", requiredSkills: ["python"] },
    prefs: { interests: ["llm"] },
    student: { name: "Sam", school: "UC Berkeley" },
  });
  assert.equal(result.job.company, "Anthropic");
  assert.ok(result.leads.length >= 3);
  assert.ok(result.leads.every(l => /^https:\/\/www\.linkedin\.com\//.test(l.searchUrl)));
  assert.match(result.safetyNote, /nothing is sent/i);
  assert.match(result.coffeeChatMessage, /coffee chat/i);
});

test("planJobSources surfaces startup boards first for startup-leaning queries", () => {
  const startup = planJobSources("YC startup software engineer");
  const general = planJobSources("software engineering internship");
  assert.equal(startup[0]?.startup, true);
  assert.ok(general.some(s => s.company === "Anthropic"));
  assert.ok(general.every(s => ["greenhouse", "ashby", "lever"].includes(s.provider)));
});

test("parseQuery extracts role, location, remote, and tech intent", () => {
  const ib = parseQuery("investment banking on the east coast");
  assert.equal(ib.where, "New York");
  assert.equal(ib.tech, false);
  assert.ok(ib.terms.includes("investment") && ib.terms.includes("banking"));

  const ml = parseQuery("machine learning at a startup, remote");
  assert.equal(ml.remote, true);
  assert.equal(ml.tech, true);
  assert.match(ml.what, /machine learning/i);

  const sf = parseQuery("product design in the bay area");
  assert.equal(sf.where, "San Francisco");
});

test("relevanceScore ranks title matches and student roles above noise", () => {
  const ml = { title: "Machine Learning Intern", company: "X", url: "u1", source: "s", evidence: "build ML models" };
  const sales = { title: "Enterprise Sales Lead", company: "X", url: "u2", source: "s", evidence: "quota" };
  assert.ok(relevanceScore(ml, ["machine", "learning"]) > relevanceScore(sales, ["machine", "learning"]));
  assert.ok(relevanceScore(ml, []) > 0); // "intern" student-relevance bonus
});
