// College Copilot — single-page controller (vanilla ES modules, no build step).

import { BERKELEY_COLLEGES } from "./berkeley-majors.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

const minToHHMM = (m) => m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const csv = (s) => (s || "").split(",").map(x => x.trim()).filter(Boolean);
const BERKELEY_TERM_IDS = { "fall-2026": "8588" };
const CURRENT_TERM = "fall-2026";

function berkeleyCourseUrl(course) {
  const params = new URLSearchParams({ search: `${course.subject} ${course.number}` });
  const termId = BERKELEY_TERM_IDS[CURRENT_TERM];
  if (termId) params.append("f[0]", `term:${termId}`);
  return `https://classes.berkeley.edu/search/class?${params}`;
}

const COURSE_PAGE_SIZE = 60;
const state = { me: null, courses: [], courseOffset: 0, courseCount: 0, cart: loadCart(), savedPlans: [] };

function loadCart() { try { return JSON.parse(localStorage.getItem("cc_cart") || "[]"); } catch { return []; } }
function saveCart() { localStorage.setItem("cc_cart", JSON.stringify(state.cart)); }

// ───────── Auth ─────────
async function boot() {
  initTheme();
  state.me = await api("/auth/me");
  if (!state.me.user) return showLogin();
  showApp();
}

function showLogin() {
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#googleBtn").hidden = !state.me.googleEnabled;
  $("#devLoginForm").hidden = !state.me.devLogin;
}

async function showApp() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  $("#userChip").textContent = state.me.user.email;
  await loadProfileIntoForm();
  if (!state.me.hasProfile) { switchTab("profile"); toast("Set your preferences to get tailored rankings."); }
  else { switchTab("discover"); }
  await loadSubjects();
  await refreshCourses();
  renderCart();
  loadSavedPlans();
}

$("#devLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/auth/dev-login", { method: "POST", body: { email: $("#devEmail").value } });
    state.me = await api("/auth/me");
    showApp();
  } catch (err) { toast(err.message); }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  location.reload();
});

$$("[data-find-opps]").forEach(btn => btn.addEventListener("click", () => {
  const category = btn.dataset.findOpps;
  const rootSel = category === "industry" ? "#jobsList" : "#researchList";
  const querySel = category === "industry" ? "#jobsQuery" : "#researchQuery";
  const traceSel = category === "industry" ? "#jobsTrace" : "#researchTrace";
  searchOpportunities(category, rootSel, querySel, traceSel, btn);
}));

// ───────── Tabs ─────────
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $("#opportunitiesMenuBtn").classList.toggle("active", name === "research" || name === "jobs");
  $(".tab-menu")?.classList.remove("open");
  $("#opportunitiesMenuBtn").setAttribute("aria-expanded", "false");
  $$(".panel-view").forEach(v => v.hidden = v.dataset.view !== name);
  if (name === "schedule") renderCalendar();
  if (name === "research") loadOpportunities("research", "#researchList");
  if (name === "jobs") loadOpportunities("industry", "#jobsList");
}
$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab?.dataset.tab) switchTab(tab.dataset.tab);
});
$("#opportunitiesMenuBtn").addEventListener("click", () => {
  const menu = $(".tab-menu");
  const open = menu.classList.toggle("open");
  $("#opportunitiesMenuBtn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (e.target.closest(".tab-menu")) return;
  $(".tab-menu")?.classList.remove("open");
  $("#opportunitiesMenuBtn").setAttribute("aria-expanded", "false");
});

// ───────── Theme ─────────
function initTheme() {
  const saved = localStorage.getItem("cc_theme");
  if (saved) document.documentElement.dataset.theme = saved;
}
$("#themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("cc_theme", next);
});

// ───────── Profile ─────────
function collegeMajors(college) {
  if (!college) return [];
  if (college.groups) return college.groups.flatMap(group => group.majors);
  return college.majors || [];
}

function findCollegeForMajor(major) {
  return BERKELEY_COLLEGES.find(college => collegeMajors(college).includes(major));
}

function populateCollegeSelect(selected = "") {
  const select = $("#profileForm").college;
  select.innerHTML = '<option value="">Choose your college</option>' +
    BERKELEY_COLLEGES.map(college =>
      `<option value="${college.name}">${college.name}</option>`
    ).join("");
  select.value = selected;
}

function populateMajorSelect(collegeName, selected = "") {
  const select = $("#profileForm").major;
  const college = BERKELEY_COLLEGES.find(item => item.name === collegeName);
  select.disabled = !college;

  if (!college) {
    select.innerHTML = '<option value="">Choose a college first</option>';
    return;
  }

  const options = college.groups
    ? college.groups.map(group => `
        <optgroup label="${group.name}">
          ${group.majors.map(major => `<option value="${major}">${major}</option>`).join("")}
        </optgroup>`).join("")
    : college.majors.map(major => `<option value="${major}">${major}</option>`).join("");

  select.innerHTML = `<option value="">Choose your major</option>${options}`;
  select.value = selected;
}

$("#profileForm").college.addEventListener("change", (event) => {
  populateMajorSelect(event.target.value);
});

async function loadProfileIntoForm() {
  const { profile } = await api("/profile");
  const f = $("#profileForm");
  const college = profile.college || findCollegeForMajor(profile.major)?.name || "";
  populateCollegeSelect(college);
  populateMajorSelect(college, profile.major || "");
  f.gradYear.value = profile.gradYear || "";
  f.interests.value = (profile.interests || []).join(", ");
  f.completedCourses.value = (profile.completedCourses || []).join(", ");
  f.requirementsRemaining.value = (profile.requirementsRemaining || []).join(", ");
  f.earliest.value = profile.timePrefs?.earliest || "09:00";
  f.latest.value = profile.timePrefs?.latest || "18:00";
  f.daysOff.value = (profile.timePrefs?.daysOff || []).join(", ");
  f.workloadTolerance.value = profile.workloadTolerance || "medium";
  f.minProfRating.value = profile.minProfRating ?? "";
}

$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    college: f.college.value,
    major: f.major.value.trim(),
    gradYear: f.gradYear.value ? Number(f.gradYear.value) : undefined,
    interests: csv(f.interests.value),
    completedCourses: csv(f.completedCourses.value),
    requirementsRemaining: csv(f.requirementsRemaining.value),
    timePrefs: { earliest: f.earliest.value, latest: f.latest.value, daysOff: csv(f.daysOff.value) },
    workloadTolerance: f.workloadTolerance.value,
    minProfRating: f.minProfRating.value ? Number(f.minProfRating.value) : undefined,
  };
  try {
    await api("/profile", { method: "PUT", body });
    $("#profileNote").textContent = "Saved ✓";
    state.me = await api("/auth/me");
    await refreshCourses();
    toast("Preferences saved — rankings updated.");
  } catch (err) { toast(err.message); }
});

// ───────── Discover ─────────
async function loadSubjects() {
  const { subjects } = await api("/courses/subjects");
  const sel = $("#subjectFilter");
  sel.innerHTML = '<option value="">All subjects</option>' +
    subjects.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function refreshCourses({ append = false } = {}) {
  const offset = append ? state.courseOffset : 0;
  const q = $("#searchInput").value.trim();
  const subject = $("#subjectFilter").value;
  const openOnly = $("#openOnly").checked;
  const params = new URLSearchParams({ limit: String(COURSE_PAGE_SIZE), offset: String(offset) });
  if (q) params.set("q", q);
  if (subject) params.set("subject", subject);
  if (openOnly) params.set("openOnly", "true");
  const { courses, count } = await api(`/courses?${params}`);
  state.courses = append ? [...state.courses, ...courses] : courses;
  state.courseOffset = offset + courses.length;
  state.courseCount = count;
  renderCourses(state.courses, $("#courseList"));
  $("#loadMoreCourses").hidden = state.courseOffset >= state.courseCount || courses.length === 0;
}

$("#searchInput").addEventListener("input", debounce(refreshCourses, 250));
$("#subjectFilter").addEventListener("change", refreshCourses);
$("#openOnly").addEventListener("change", refreshCourses);
$("#loadMoreCourses").addEventListener("click", () => refreshCourses({ append: true }));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function scoreClass(s) { return s >= 75 ? "s-hi" : s >= 55 ? "s-mid" : "s-lo"; }

function courseCard(c, { research = false } = {}) {
  const s = c.section;
  const time = s && s.startMin != null ? `${s.days || ""} ${minToHHMM(s.startMin)}–${minToHHMM(s.endMin)}` : "Async / TBA";
  const inCart = state.cart.some(x => x.id === c.id);
  const rmp = c.instructor?.rmpRating;
  const tags = [
    `<span class="tag">${c.units ?? "?"} units</span>`,
    c.instructor ? `<span class="tag">${c.instructor.name}</span>` : "",
    rmp != null ? `<span class="tag ${rmp >= 4 ? "good" : rmp < 3 ? "bad" : ""}">RMP ${rmp.toFixed(1)}</span>` : "",
    c.avgGpa != null ? `<span class="tag">avg GPA ${c.avgGpa.toFixed(2)}</span>` : "",
    `<span class="tag ${c.fit.workload.estimate === "heavy" ? "warn" : c.fit.workload.estimate === "light" ? "good" : ""}">${c.fit.workload.estimate} load</span>`,
    `<span class="tag">${time}</span>`,
    c.fit.flags.requirementMatch ? `<span class="tag good">requirement ✓</span>` : "",
    c.fit.flags.timeConflict ? `<span class="tag bad">time clash</span>` : "",
  ].filter(Boolean).join("");
  const reasons = c.fit.reasons.map(r => `<li>${r}</li>`).join("");
  const actions = research ? "" : `
    <div class="card-actions">
      <button data-add="${c.id}">${inCart ? "✓ In schedule" : "+ Add to schedule"}</button>
      <a class="course-catalog-link" href="${berkeleyCourseUrl(c)}" target="_blank" rel="noopener noreferrer">View Fall 2026 classes ↗</a>
    </div>`;
  return `<article class="course-card">
    <div>
      <h3><span class="course-code">${c.subject} ${c.number}</span> — ${c.title}</h3>
      <div class="course-meta">${tags}</div>
      <ul class="reasons">${reasons}</ul>
      ${c.description ? `<p class="desc">${c.description.slice(0, 180)}${c.description.length > 180 ? "…" : ""}</p>` : ""}
    </div>
    <div class="score-badge ${scoreClass(c.fit.score)}">
      <small>Match score</small>
      <span>${c.fit.score}</span>
    </div>
    ${actions}
  </article>`;
}

function renderCourses(courses, root) {
  if (!courses.length) { root.innerHTML = `<div class="empty">No courses match. Try importing more subjects or relaxing filters.</div>`; return; }
  root.innerHTML = courses.map(c => courseCard(c)).join("");
  $$("[data-add]", root).forEach(btn => btn.addEventListener("click", () => addToCart(btn.dataset.add)));
}

// ───────── Advisor (Phase 2 endpoint, graceful fallback to search) ─────────
$("#advisorBtn").addEventListener("click", runAdvisor);
$("#advisorInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runAdvisor(); });
async function runAdvisor() {
  const query = $("#advisorInput").value.trim();
  if (!query) return;
  const summary = $("#advisorSummary");
  $("#loadMoreCourses").hidden = true;
  summary.hidden = false; summary.textContent = "Thinking…";
  try {
    const r = await api("/advisor", { method: "POST", body: { query } });
    const steps = (r.steps || []).map(s =>
      `<li class="${s.ok ? "" : "step-fail"}"><b>${s.agent}</b> — ${s.summary}</li>`).join("");
    const schedBtn = (r.schedule && r.schedule.length)
      ? `<button id="useAdvisorSchedule" class="btn">Use this ${r.schedule.length}-class schedule →</button>` : "";
    summary.innerHTML = `
      <div><strong>Copilot:</strong> ${r.summary} <span class="muted small">(${r.mode})</span></div>
      <details class="agent-trace" open><summary>How the agents worked (${(r.steps||[]).length} steps)</summary>
        <ol class="trace-list">${steps}</ol></details>
      ${schedBtn}`;
    renderCourses(r.courses, $("#courseList"));
    const sb = $("#useAdvisorSchedule");
    if (sb) sb.addEventListener("click", () => {
      state.cart = r.schedule.map(c => ({ id: c.id, label: `${c.subject} ${c.number}`, title: c.title, section: c.section }));
      saveCart(); renderCart(); switchTab("schedule");
      toast(`Loaded the Copilot's ${r.schedule.length}-class schedule.`);
    });
  } catch (err) {
    // Fallback: treat the query as a keyword search until the advisor agent is live.
    summary.innerHTML = `<strong>Copilot:</strong> showing keyword matches for “${query}”. <span class="muted">(advisor agent: ${err.message})</span>`;
    $("#searchInput").value = query;
    refreshCourses();
  }
}

// ───────── Schedule cart + calendar ─────────
function addToCart(id) {
  const c = state.courses.find(x => x.id === id);
  if (!c || state.cart.some(x => x.id === id)) return;
  const conflict = state.cart.find(item => sectionsConflict(item.section, c.section));
  if (conflict) return toast(`${c.subject} ${c.number} conflicts with ${conflict.label}.`);
  state.cart.push({ id: c.id, label: `${c.subject} ${c.number}`, title: c.title, section: c.section });
  saveCart(); renderCart(); refreshCourses();
  toast(`Added ${c.subject} ${c.number}`);
}
function removeFromCart(id) { state.cart = state.cart.filter(x => x.id !== id); saveCart(); renderCart(); renderCalendar(); refreshCourses(); }

function renderCart() {
  const bar = $("#cartBar");
  if (!bar) return;
  bar.innerHTML = state.cart.length
    ? state.cart.map(x => `<span class="cart-item">${x.label}<button data-rm="${x.id}">✕</button></span>`).join("")
    : `<span class="muted small">No classes added yet — add some from Discover.</span>`;
  $$("[data-rm]", bar).forEach(b => b.addEventListener("click", () => removeFromCart(b.dataset.rm)));
}

const DAYS = [["M", "Mon"], ["Tu", "Tue"], ["W", "Wed"], ["Th", "Thu"], ["F", "Fri"]];
const CAL_START = 8 * 60, CAL_END = 20 * 60;
function parseDayCodes(code) {
  if (!code) return [];
  const out = []; let i = 0;
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (["Tu", "Th", "Sa", "Su"].includes(two)) { out.push(two); i += 2; }
    else { out.push(code[i]); i += 1; }
  }
  return out;
}

function sectionsConflict(a, b) {
  if (!a || !b || a.startMin == null || a.endMin == null || b.startMin == null || b.endMin == null) return false;
  return parseDayCodes(a.days).some(day => parseDayCodes(b.days).includes(day)) &&
    a.startMin < b.endMin && b.startMin < a.endMin;
}

function renderCalendar() {
  const cal = $("#calendar");
  if (!cal) return;
  cal.innerHTML = calendarMarkup(state.cart);
}

function calendarMarkup(items) {
  const span = CAL_END - CAL_START;
  let html = `<div class="cal-head"></div>` + DAYS.map(([, full]) => `<div class="cal-head">${full}</div>`).join("");
  html += `<div class="cal-col">` + Array.from({ length: 13 }, (_, h) =>
    `<div class="cal-hour" style="top:${((h * 60) / span) * 100}%">${8 + h}</div>`).join("") + `</div>`;

  // Detect conflicts.
  const events = [];
  for (const item of items) {
    const s = item.section;
    if (!s || s.startMin == null) continue;
    for (const d of parseDayCodes(s.days)) events.push({ day: d, start: s.startMin, end: s.endMin, label: item.label });
  }
  for (const e of events) e.conflict = events.some(o => o !== e && o.day === e.day && e.start < o.end && o.start < e.end);

  for (const [code] of DAYS) {
    html += `<div class="cal-col" data-day="${code}">`;
    for (const e of events.filter(ev => ev.day === code)) {
      const top = ((e.start - CAL_START) / span) * 100;
      const height = ((e.end - e.start) / span) * 100;
      html += `<div class="cal-event ${e.conflict ? "conflict" : ""}" style="top:${top}%;height:${height}%">${e.label}<br>${minToHHMM(e.start)}</div>`;
    }
    html += `</div>`;
  }
  return html;
}

$("#buildScheduleBtn").addEventListener("click", async () => {
  try {
    const subject = $("#subjectFilter").value || undefined;
    const r = await api("/schedule/suggest", { method: "POST", body: { subject, openOnly: true } });
    if (!r.courses.length) return toast("No conflict-free schedule found — try importing more subjects.");
    state.cart = r.courses.map(c => ({ id: c.id, label: `${c.subject} ${c.number}`, title: c.title, section: c.section }));
    saveCart(); renderCart(); renderCalendar();
    toast(`Auto-built ${r.courses.length} classes (${r.totalUnits} units), conflict-free.`);
  } catch (err) { toast(`Auto-build: ${err.message}`); }
});

$("#clearScheduleBtn").addEventListener("click", () => {
  if (!state.cart.length) return toast("The schedule is already empty.");
  state.cart = [];
  saveCart();
  renderCart();
  renderCalendar();
  refreshCourses();
  toast("Schedule cleared.");
});

$("#savePlanBtn").addEventListener("click", async () => {
  const name = $("#planName").value.trim() || "Untitled plan";
  const sectionIds = state.cart.map(x => x.section?.id).filter(Boolean);
  if (!sectionIds.length) return toast("Add some classes first.");
  try {
    await api("/plans", { method: "POST", body: { name, sectionIds } });
    toast("Plan saved ✓");
    loadSavedPlans();
  } catch (err) { toast(`Save plan: ${err.message}`); }
});

async function loadSavedPlans() {
  const root = $("#savedPlans");
  if (!root) return;
  try {
    const { plans } = await api("/plans");
    state.savedPlans = plans;
    root.innerHTML = plans.length
      ? `<div class="saved-plans-head"><h3>Saved schedules</h3><button id="comparePlansBtn" class="btn">Compare selected</button></div>` +
        plans.map(p => `<div class="saved-plan">
          <label><input type="checkbox" data-compare="${p.id}"> ${p.name} · ${p.courses.length} classes</label>
          <div><button data-load="${p.id}">Load</button><button data-del="${p.id}">Delete</button></div>
        </div>`).join("")
      : "";
    $$("[data-load]", root).forEach(b => b.addEventListener("click", () => {
      const plan = state.savedPlans.find(p => p.id === b.dataset.load);
      if (!plan) return;
      state.cart = plan.courses;
      saveCart(); renderCart(); renderCalendar();
      toast(`Loaded ${plan.name}.`);
    }));
    $$("[data-del]", root).forEach(b => b.addEventListener("click", async () => {
      await api(`/plans/${b.dataset.del}`, { method: "DELETE" }); loadSavedPlans();
    }));
    $("#comparePlansBtn")?.addEventListener("click", compareSelectedPlans);
  } catch { root.innerHTML = ""; }
}

function compareSelectedPlans() {
  const ids = $$("[data-compare]:checked").map(input => input.dataset.compare);
  if (ids.length < 2) return toast("Select at least 2 saved schedules.");
  if (ids.length > 6) return toast("Compare up to 6 schedules at a time.");
  const plans = ids.map(id => state.savedPlans.find(plan => plan.id === id)).filter(Boolean);
  $("#scheduleCompare").innerHTML = `<h3>Schedule comparison</h3><div class="comparison-grid count-${plans.length}">${plans.map(plan => `
    <article class="comparison-card">
      <h4>${plan.name}</h4>
      <div class="calendar compact">${calendarMarkup(plan.courses)}</div>
      <p class="small muted">${plan.courses.map(course => course.label).join(" · ")}</p>
    </article>`).join("")}</div>`;
}

// ───────── Opportunities (Research + Jobs) ─────────
async function loadOpportunities(category, rootSel) {
  const root = $(rootSel);
  root.innerHTML = `<div class="empty">No saved ${category === "industry" ? "job" : "research"} results yet. Run an agent search above.</div>`;
  try {
    const { opportunities } = await api(`/opportunities?category=${category}`);
    if (!opportunities?.length) {
      return;
    }
    renderOpportunities(root, category, opportunities);
  } catch (err) {
    root.innerHTML = `<div class="empty">Couldn't load cached ${category} results. (${err.message})</div>`;
  }
}

async function searchOpportunities(category, rootSel, querySel, traceSel, btn) {
  const root = $(rootSel);
  const trace = $(traceSel);
  const query = $(querySel)?.value?.trim() || "";
  btn.disabled = true;
  btn.textContent = "Searching…";
  root.innerHTML = `<div class="empty">Agents are searching live sources…</div>`;
  trace.hidden = true;
  try {
    const result = await api("/opportunities/search", {
      method: "POST",
      body: { category, query, limit: 12 },
    });
    renderAgentTrace(trace, result);
    if (!result.opportunities?.length) {
      root.innerHTML = `<div class="empty">No matches found from the live sources. Try a broader query.</div>`;
      return;
    }
    renderOpportunities(root, category, result.opportunities);
  } catch (err) {
    root.innerHTML = `<div class="empty">Opportunity agents failed. (${err.message})</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = category === "industry" ? "Find jobs" : "Find research";
  }
}

function renderAgentTrace(root, result) {
  if (!root) return;
  const steps = result.steps || [];
  root.hidden = false;
  root.innerHTML = `
    <div class="trace-head">
      <strong>Agent run</strong>
      <span>${result.mode || "live-agent"} · memory: ${result.memory || "disabled"}</span>
    </div>
    <div class="trace-steps">
      ${steps.map(s => `<span class="${s.ok ? "ok" : "warn"}">${s.agent}: ${s.summary}</span>`).join("")}
    </div>`;
}

function renderOpportunities(root, category, opportunities) {
  root.innerHTML = opportunities.map(o => {
      const reasons = (o.reasons || []).map(r => `<li>${r}</li>`).join("");
      return `<article class="course-card">
        <div>
          <h3>${o.name || o.project || "Opportunity"}</h3>
          <div class="course-meta">
            <span class="tag">${o.org || "org"}</span>
            <span class="tag ${category === "industry" ? "warn" : "good"}">${category}</span>
            ${o.contact ? `<span class="tag">has contact</span>` : ""}
          </div>
          <ul class="reasons">${reasons}</ul>
          ${o.project ? `<p class="desc">${o.project}</p>` : ""}
        </div>
        <div class="score-badge ${scoreClass(o.fitScore)}">
          <small>Match score</small>
          <span>${o.fitScore}</span>
        </div>
        <div class="card-actions">
          ${o.source ? `<a class="btn" href="${o.source}" target="_blank" rel="noopener">Open source ↗</a>` : ""}
          <button data-draft="${o.id}">✎ Draft outreach</button>
        </div>
      </article>`;
  }).join("");
  $$("[data-draft]", root).forEach(b => b.addEventListener("click", () => draftOutreach(b.dataset.draft, b)));
}

async function draftOutreach(targetId, btn) {
  btn.disabled = true; btn.textContent = "Drafting…";
  try {
    const r = await api("/opportunities/draft", { method: "POST", body: { targetId } });
    const draft = r.draft || r.email || "";
    // Open Gmail compose with the draft prefilled (nothing sends automatically).
    const subject = (draft.match(/^Subject:\s*(.+)$/m) || [])[1] || "Reaching out";
    const body = draft.replace(/^Subject:\s*.+\n?/m, "").trim();
    const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    toast("Draft ready — Gmail compose opened.");
  } catch (err) {
    toast(`Draft: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = "✎ Draft outreach";
  }
}

boot().catch(err => { console.error(err); toast(err.message); });
