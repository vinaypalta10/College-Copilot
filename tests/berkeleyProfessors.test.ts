import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEecsFacultyList, parseEecsFacultyBio } from "../src/providers/berkeleyProfessors.ts";

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
  assert.equal(results[0].name, "Pieter Abbeel");
  assert.equal(results[0].imageUrl, "https://www2.eecs.berkeley.edu/Faculty/Photos/Homepages/abbeel.jpg");
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
