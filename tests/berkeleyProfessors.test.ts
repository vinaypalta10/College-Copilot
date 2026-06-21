import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  parseEecsFacultyList,
  parseEecsFacultyBio,
  searchImportedBerkeleyProfessors,
} from "../src/providers/berkeleyProfessors.ts";
import {
  parseDepartmentFacultyDetail,
  parseDepartmentFacultyList,
  parseVcrFacultyDetail,
  parseVcrFacultyListPage,
} from "../src/ingest/berkeleyFaculty.ts";
import { Repo } from "../src/db/repo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "src", "db", "schema.sql"), "utf8");

test("parseEecsFacultyList extracts the actual professor homepage portrait image", () => {
  const html = `
    <div class="cc-image-list__item column">
      <div class="cc-image-list__item__image">
        <a href="/Faculty/Homepages/abbeel.html">
          <img src="/Faculty/Photos/Homepages/abbeel.jpg" width="150" height="210" alt="Pieter Abbeel">
        </a>
      </div>
      <div class="cc-image-list__item__content">
        <h3>
          <span id=A></span>
          <a href="/Faculty/Homepages/abbeel.html">Pieter Abbeel</a>
        </h3>
        <p>
          <strong>Professor</strong>
          <br>746 Sutardja Dai Hall, pabbeel@cs.berkeley.edu
          <br><strong>Research Interests:</strong> <a href="/Research/Areas/AI">Artificial Intelligence (AI)</a>
        </p>
      </div>
    </div>
  `;
  const results = parseEecsFacultyList(html, { name: "Test", url: "https://www2.eecs.berkeley.edu/Faculty/Lists/CS/faculty.html" });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.name, "Pieter Abbeel");
  assert.equal(results[0]!.imageUrl, "https://www2.eecs.berkeley.edu/Faculty/Photos/Homepages/abbeel.jpg");
});

test("parseEecsFacultyBio selects the homepage image only when it matches the professor name", () => {
  const html = `
    <div class="profile">
      <img src="/Faculty/Photos/Homepages/abbeel.jpg" alt="Pieter Abbeel">
      <h2>Profile</h2>
      <h3>Pieter Abbeel</h3>
      <h4>Biography</h4>
      <p>Pieter Abbeel researches reinforcement learning and robotics.</p>
      <h4>Research Areas</h4>
      <p>Artificial Intelligence (AI)</p>
    </div>
  `;
  const parsed = parseEecsFacultyBio(html, "https://www2.eecs.berkeley.edu/Faculty/Homepages/abbeel.html", "Pieter Abbeel");
  assert.equal(parsed.imageUrl, "https://www2.eecs.berkeley.edu/Faculty/Photos/Homepages/abbeel.jpg");
  assert.ok(parsed.bio.includes("reinforcement learning"));
});

test("parseVcrFacultyListPage extracts departments, expertise, and pagination", () => {
  const html = `
    <article class="node faculty faculty--teaser">
      <a href="/faculty/pieter-abbeel" class="field--name-field-photo">
        <img src="/photos/abbeel.jpg" alt="Pieter Abbeel">
      </a>
      <a href="/faculty/pieter-abbeel" class="field--name-field-name">
        <span class="field field--name-title">Pieter Abbeel</span>
      </a>
      <div class="field field--name-field-department field__items">
        <div class="field__item"><a href="/taxonomy/term/68">Division of Computer Science (EECS)</a></div>
      </div>
      <div class="field field--name-field-areas-of-expertise field__items">
        <span class="field__item"><a href="/robotics">robotics</a></span>,
        <span class="field__item"><a href="/machine-learning">machine learning</a></span>
      </div>
    </article>
    <a class="button" href="?page=1" rel="next">Load More</a>
  `;
  const parsed = parseVcrFacultyListPage(html);
  assert.equal(parsed.faculty.length, 1);
  assert.deepEqual(parsed.faculty[0]!.departments, ["Division of Computer Science (EECS)"]);
  assert.deepEqual(parsed.faculty[0]!.researchInterests, ["robotics", "machine learning"]);
  assert.equal(parsed.nextUrl, "https://vcresearch.berkeley.edu/faculty-expertise?page=1");
});

test("parseVcrFacultyDetail enriches public profile metadata", () => {
  const original = parseVcrFacultyListPage(`
    <article class="faculty--teaser">
      <a href="/faculty/pieter-abbeel" class="field--name-field-name"><span>Pieter Abbeel</span></a>
      <div class="field--name-field-department"><a>Division of Computer Science (EECS)</a></div>
      <div class="field--name-field-areas-of-expertise"><a>robotics</a></div>
    </article>
  `).faculty[0]!;
  const detail = parseVcrFacultyDetail(`
    <meta property="og:image" content="/photos/abbeel-large.jpg">
    <script type="application/ld+json">
      {"@graph":[{"@type":"Person","name":"Pieter Abbeel","jobTitle":"Professor",
      "description":"Researches intelligent robotic systems.",
      "worksFor":{"name":"Division of Computer Science (EECS)"},
      "knowsAbout":["robotics","artificial intelligence"]}]}
    </script>
    <a href=mailto:pabbeel@cs.berkeley.edu>Email</a>
  `, original);
  assert.equal(detail.email, "pabbeel@cs.berkeley.edu");
  assert.equal(detail.title, "Professor");
  assert.ok(detail.researchInterests.includes("artificial intelligence"));
  assert.equal(detail.imageUrl, "https://vcresearch.berkeley.edu/photos/abbeel-large.jpg");
});

test("department parser extracts Ani Adhikari from the Statistics directory", () => {
  const source = {
    name: "Berkeley Statistics faculty",
    department: "Dept of Statistics",
    url: "https://statistics.berkeley.edu/people/faculty",
    parser: "drupal-article" as const,
  };
  const records = parseDepartmentFacultyList(`
    <article class="node node--type-faculty node--view-mode-teaser">
      <a href="/people/ani-adhikari"><img src="/faculty/adhikari.jpg" alt="Ani Adhikari"></a>
      <h3 class="page--title"><a href="/people/ani-adhikari">Ani Adhikari</a></h3>
      <div class="field field--name-field-job-title field__item">Teaching Professor</div>
    </article>
  `, source);
  assert.equal(records[0]?.name, "Ani Adhikari");
  assert.equal(records[0]?.title, "Teaching Professor");
  assert.equal(records[0]?.profileUrl, "https://statistics.berkeley.edu/people/ani-adhikari");

  const enriched = parseDepartmentFacultyDetail(`
    <div class="field field--name-field-email">
      <div class="field__item">adhikari@berkeley.edu</div>
    </div>
  `, records[0]!);
  assert.equal(enriched.email, "adhikari@berkeley.edu");
});

test("imported professor search puts an exact name above profile-interest matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "professor-search-"));
  const db = new Database(join(dir, "test.db"));
  db.exec(schema);
  const repo = new Repo(db);
  const now = new Date().toISOString();
  try {
    repo.upsertProfessor({
      id: "john",
      name: "John DeNero",
      normalized_name: "john denero",
      email: "denero@berkeley.edu",
      title: "Teaching Professor",
      departments: JSON.stringify(["Division of Computer Science (EECS)"]),
      research_interests: JSON.stringify(["Artificial Intelligence", "Education"]),
      bio: "Researches natural language processing and computer science education.",
      profile_url: "https://www2.eecs.berkeley.edu/Faculty/Homepages/denero.html",
      image_url: null,
      source_names: JSON.stringify(["Berkeley EECS CS faculty"]),
      source_urls: JSON.stringify([]),
      imported_at: now,
      last_seen_at: now,
      active: 1,
    });
    repo.upsertProfessor({
      id: "robotics",
      name: "Robotics Researcher",
      normalized_name: "robotics researcher",
      email: "robotics@berkeley.edu",
      title: "Professor",
      departments: JSON.stringify(["Engineering"]),
      research_interests: JSON.stringify(["robotics", "machine learning"]),
      bio: "Robotics and machine learning.",
      profile_url: "https://example.com",
      image_url: null,
      source_names: JSON.stringify(["Test"]),
      source_urls: JSON.stringify([]),
      imported_at: now,
      last_seen_at: now,
      active: 1,
    });
    const results = searchImportedBerkeleyProfessors(db, {
      query: "John DeNero",
      profileTerms: ["robotics", "machine learning"],
      limit: 12,
    });
    assert.equal(results[0]!.name, "John DeNero");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("person-name searches do not return unrelated biography matches", () => {
  const db = new Database(":memory:");
  db.exec(schema);
  const repo = new Repo(db);
  const now = new Date().toISOString();
  try {
    repo.upsertProfessor({
      id: "unrelated",
      name: "Aaron Fisher",
      normalized_name: "aaron fisher",
      email: "fisher@berkeley.edu",
      title: "Professor",
      departments: JSON.stringify(["Psychology"]),
      research_interests: JSON.stringify(["statistics"]),
      bio: "Studies dynamic and individualized systems.",
      profile_url: "https://example.com",
      image_url: null,
      source_names: JSON.stringify(["Test"]),
      source_urls: JSON.stringify([]),
      imported_at: now,
      last_seen_at: now,
      active: 1,
    });
    assert.deepEqual(searchImportedBerkeleyProfessors(db, {
      query: "Ani Adhikari",
      profileTerms: [],
      limit: 12,
    }), []);
  } finally {
    db.close();
  }
});
