// College Copilot — single-page controller (vanilla ES modules, no build step).

import { BERKELEY_COLLEGES } from "./berkeley-majors.js";
import { initVoice } from "./voice.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[ch]));
function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}

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
const esc = (s = "") => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
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
  initVoice({ toast });
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

$("#findLabsBtn")?.addEventListener("click", searchLabs);
$("#labsQuery")?.addEventListener("keydown", (e) => { if (e.key === "Enter") searchLabs(); });
$("#findJobsBtn")?.addEventListener("click", () => searchJobs($("#findJobsBtn")));
$("#jobsQuery")?.addEventListener("keydown", (e) => { if (e.key === "Enter") searchJobs($("#findJobsBtn")); });
$("#findProfessorsBtn")?.addEventListener("click", searchProfessors);
$("#professorQuery")?.addEventListener("keydown", (e) => { if (e.key === "Enter") searchProfessors(); });

// ───────── Tabs ─────────
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $("#opportunitiesMenuBtn").classList.toggle("active", name === "professors" || name === "programs" || name === "jobs");
  $(".tab-menu")?.classList.remove("open");
  $("#opportunitiesMenuBtn").setAttribute("aria-expanded", "false");
  $(".tab-submenu.open")?.classList.remove("open");
  $(".submenu-trigger")?.setAttribute("aria-expanded", "false");
  $$(".panel-view").forEach(v => v.hidden = v.dataset.view !== name);
  if (name === "schedule") renderCalendar();
  if (name === "professors") initProfessorPanel();
  if (name === "programs") initLabsPanel();
  if (name === "jobs") loadJobs();
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
$(".submenu-trigger")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const submenu = e.target.closest(".tab-submenu");
  if (!submenu) return;
  const open = submenu.classList.toggle("open");
  e.target.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (e.target.closest(".tab-menu")) return;
  $(".tab-menu")?.classList.remove("open");
  $("#opportunitiesMenuBtn").setAttribute("aria-expanded", "false");
  $(".tab-submenu.open")?.classList.remove("open");
  $(".submenu-trigger")?.setAttribute("aria-expanded", "false");
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
      `<option value="${escapeHtml(college.name)}">${escapeHtml(college.name)}</option>`
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
        <optgroup label="${escapeHtml(group.name)}">
          ${group.majors.map(major => `<option value="${escapeHtml(major)}">${escapeHtml(major)}</option>`).join("")}
        </optgroup>`).join("")
    : college.majors.map(major => `<option value="${escapeHtml(major)}">${escapeHtml(major)}</option>`).join("");

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
    subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
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
    `<span class="tag">${escapeHtml(c.units ?? "?")} units</span>`,
    c.instructor ? `<span class="tag">${escapeHtml(c.instructor.name)}</span>` : "",
    rmp != null ? `<span class="tag ${rmp >= 4 ? "good" : rmp < 3 ? "bad" : ""}">RMP ${rmp.toFixed(1)}</span>` : "",
    c.avgGpa != null ? `<span class="tag">avg GPA ${c.avgGpa.toFixed(2)}</span>` : "",
    `<span class="tag ${c.fit.workload.estimate === "heavy" ? "warn" : c.fit.workload.estimate === "light" ? "good" : ""}">${escapeHtml(c.fit.workload.estimate)} load</span>`,
    `<span class="tag">${escapeHtml(time)}</span>`,
    c.fit.flags.requirementMatch ? `<span class="tag good">requirement ✓</span>` : "",
    c.fit.flags.timeConflict ? `<span class="tag bad">time clash</span>` : "",
  ].filter(Boolean).join("");
  const reasons = c.fit.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("");
  const actions = research ? "" : `
    <div class="card-actions">
      <button data-add="${escapeHtml(c.id)}">${inCart ? "✓ In schedule" : "+ Add to schedule"}</button>
      <a class="course-catalog-link" href="${berkeleyCourseUrl(c)}" target="_blank" rel="noopener noreferrer">View Fall 2026 classes ↗</a>
    </div>`;
  return `<article class="course-card">
    <div>
      <h3><span class="course-code">${escapeHtml(c.subject)} ${escapeHtml(c.number)}</span> — ${escapeHtml(c.title)}</h3>
      <div class="course-meta">${tags}</div>
      <ul class="reasons">${reasons}</ul>
      ${c.description ? `<p class="desc">${escapeHtml(c.description.slice(0, 180))}${c.description.length > 180 ? "…" : ""}</p>` : ""}
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
      `<li class="${s.ok ? "" : "step-fail"}"><b>${escapeHtml(s.agent)}</b> — ${escapeHtml(s.summary)}</li>`).join("");
    const coverage = (r.coverage || []).length
      ? `<div class="advisor-insight"><strong>Requirement coverage:</strong> ${r.coverage.map(item =>
          `${escapeHtml(item.requirement)} (${item.courses.map(escapeHtml).join(", ")})`).join(" · ")}</div>` : "";
    const uncovered = (r.uncovered || []).length
      ? `<div class="advisor-insight warn"><strong>Still open:</strong> ${r.uncovered.map(escapeHtml).join(", ")}</div>` : "";
    const compression = r.compression
      ? `<div class="advisor-insight muted"><strong>Context:</strong> ${r.compression.afterTokens} tokens after compression (${r.compression.savedPct}% smaller than raw catalog context).</div>` : "";
    const followUp = r.followUp
      ? `<div class="advisor-follow-up"><strong>One question:</strong> ${escapeHtml(r.followUp)}</div>` : "";
    const policy = (r.policy?.warnings || []).length
      ? `<div class="advisor-insight muted"><strong>Policy notes:</strong> ${r.policy.warnings.map(escapeHtml).join(" ")}</div>` : "";
    summary.innerHTML = `
      <div><strong>Copilot:</strong> ${escapeHtml(r.summary)} <span class="muted small">(${escapeHtml(r.mode)})</span></div>
      ${followUp}${policy}${coverage}${uncovered}${compression}
      <details class="agent-trace" open><summary>How the agents worked (${(r.steps||[]).length} steps)</summary>
        <ol class="trace-list">${steps}</ol></details>
      `;
    if (r.intent === "course_search") renderCourses(r.courses, $("#courseList"));
  } catch (err) {
    // Fallback: treat the query as a keyword search until the advisor agent is live.
    summary.innerHTML = `<strong>Copilot:</strong> showing keyword matches for “${escapeHtml(query)}”. <span class="muted">(advisor agent: ${escapeHtml(err.message)})</span>`;
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
    ? state.cart.map(x => `<span class="cart-item">${escapeHtml(x.label)}<button data-rm="${escapeHtml(x.id)}">✕</button></span>`).join("")
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
      html += `<div class="cal-event ${e.conflict ? "conflict" : ""}" style="top:${top}%;height:${height}%">${escapeHtml(e.label)}<br>${minToHHMM(e.start)}</div>`;
    }
    html += `</div>`;
  }
  return html;
}

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
          <label><input type="checkbox" data-compare="${escapeHtml(p.id)}"> ${escapeHtml(p.name)} · ${p.courses.length} classes</label>
          <div><button data-load="${escapeHtml(p.id)}">Load</button><button data-del="${escapeHtml(p.id)}">Delete</button></div>
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
      <h4>${escapeHtml(plan.name)}</h4>
      <div class="calendar compact">${calendarMarkup(plan.courses)}</div>
      <p class="small muted">${plan.courses.map(course => escapeHtml(course.label)).join(" · ")}</p>
    </article>`).join("")}</div>`;
}

// ───────── Research labs ─────────
function initLabsPanel() {
  const root = $("#labsList");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  root.innerHTML = `<div class="empty lab-empty">Search a research topic to find matching Berkeley labs.</div>`;
}

async function searchLabs() {
  const root = $("#labsList");
  const status = $("#labsStatus");
  const btn = $("#findLabsBtn");
  const query = $("#labsQuery")?.value?.trim() || "";
  if (!root || !btn) return;

  btn.disabled = true;
  btn.textContent = "Searching...";
  status.textContent = "Finding labs that match your interests...";
  root.innerHTML = "";
  try {
    const result = await api("/opportunities/search", {
      method: "POST",
      body: { category: "research", query, limit: 12 },
    });
    const labs = result.opportunities || [];
    status.textContent = labs.length ? `${labs.length} matching lab${labs.length === 1 ? "" : "s"}` : "No matching labs";
    if (!labs.length) {
      root.innerHTML = `<div class="empty lab-empty">Try a broader topic such as AI, design, robotics, or systems.</div>`;
      return;
    }
    renderLabs(root, labs);
  } catch (err) {
    status.textContent = "Search unavailable";
    root.innerHTML = `<div class="empty lab-empty">We couldn't load labs right now. ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find labs";
  }
}

function renderLabs(root, labs) {
  root.innerHTML = labs.map((lab) => {
    const sourceUrl = safeExternalUrl(lab.source);
    const reason = (lab.reasons || [])[0] || "Listed in the Berkeley research lab directory.";
    return `<article class="lab-card">
      <div class="lab-card-top">
        <span class="lab-org">${escapeHtml(lab.org || "UC Berkeley")}</span>
        <span class="lab-match">${Math.round(lab.fitScore || 0)}% match</span>
      </div>
      <h3>${escapeHtml(lab.name || "Research lab")}</h3>
      <p>${escapeHtml(lab.project || "Visit the official lab page to learn about current research.")}</p>
      <div class="lab-topics">${(lab.topics || []).slice(0, 4).map((topic) => `<span>${escapeHtml(topic)}</span>`).join("")}</div>
      <p class="lab-reason">${escapeHtml(reason)}</p>
      ${sourceUrl ? `<a class="btn lab-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Visit lab <span aria-hidden="true">↗</span></a>` : ""}
    </article>`;
  }).join("");
}


// ───────── Jobs / Internships (NormalizedJob schema) ─────────
const EMPLOYMENT_LABEL = {
  internship: "Internship",
  new_grad: "New grad",
  part_time: "Part-time",
  full_time: "Full-time",
};

async function loadJobs() {
  const root = $("#jobsList");
  if (!root) return;
  root.innerHTML = `<div class="empty">No saved jobs yet. Run an agent search above.</div>`;
  try {
    const { jobs } = await api("/jobs");
    if (!jobs?.length) return;
    renderJobs(root, jobs);
  } catch (err) {
    root.innerHTML = `<div class="empty">Couldn't load cached jobs. (${escapeHtml(err.message)})</div>`;
  }
}

async function searchJobs(btn) {
  const root = $("#jobsList");
  const query = $("#jobsQuery")?.value?.trim() || "";
  if (!root || !btn) return;
  btn.disabled = true;
  btn.textContent = "Searching…";
  root.innerHTML = `<div class="empty">Agents are searching live job boards…</div>`;
  try {
    const result = await api("/jobs/search", { method: "POST", body: { query, limit: 12 } });
    if (!result.jobs?.length) {
      root.innerHTML = `<div class="empty">No matching openings found. Try a broader query.</div>`;
      return;
    }
    renderJobs(root, result.jobs);
  } catch (err) {
    root.innerHTML = `<div class="empty">Job agents failed. (${escapeHtml(err.message)})</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find jobs";
  }
}

function chipList(items, max = 6) {
  if (!items?.length) return "";
  const shown = items.slice(0, max).map(s => `<span class="tag">${escapeHtml(s)}</span>`).join("");
  const more = items.length > max ? `<span class="tag muted-tag">+${items.length - max}</span>` : "";
  return shown + more;
}

const jobCache = new Map();

function renderJobs(root, jobs) {
  jobs.forEach(j => jobCache.set(j.id, j));
  root.innerHTML = jobs.map(j => {
    const sourceUrl = safeExternalUrl(j.url);
    return `<article class="course-card job-card">
      <div>
        <h3>${escapeHtml(j.title || "Role")}</h3>
        <div class="course-meta">
          <span class="tag">${escapeHtml(j.company || "Company")}</span>
          <span class="tag warn">${escapeHtml(EMPLOYMENT_LABEL[j.employmentType] || j.employmentType || "Role")}</span>
          ${j.location ? `<span class="tag">${escapeHtml(j.location)}</span>` : ""}
          ${j.applicationDeadline ? `<span class="tag good">Apply by ${escapeHtml(j.applicationDeadline)}</span>` : ""}
        </div>
        <ul class="reasons">${(j.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
        ${j.requiredSkills?.length ? `<p class="job-section"><strong>Required</strong> ${chipList(j.requiredSkills)}</p>` : ""}
        ${j.preferredSkills?.length ? `<p class="job-section"><strong>Preferred</strong> ${chipList(j.preferredSkills)}</p>` : ""}
        ${j.responsibilities?.length ? `<details class="job-details"><summary>Responsibilities (${j.responsibilities.length})</summary><ul>${j.responsibilities.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul></details>` : ""}
        ${j.qualifications?.length ? `<details class="job-details"><summary>Qualifications (${j.qualifications.length})</summary><ul>${j.qualifications.map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul></details>` : ""}
      </div>
      <div class="card-actions">
        ${sourceUrl ? `<a class="btn" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open posting ↗</a>` : ""}
        <button data-resume="${escapeHtml(j.id)}">✎ Resume prompt</button>
        <button data-network="${escapeHtml(j.id)}">☕ Networking</button>
      </div>
    </article>`;
  }).join("");
  $$("[data-resume]", root).forEach(b => b.addEventListener("click", () => generateResumePrompt(b.dataset.resume, b)));
  $$("[data-network]", root).forEach(b => b.addEventListener("click", () => findNetworking(b.dataset.network, b)));
}

function openJobDialog(html) {
  const dialog = $("#jobDialog");
  const body = $("#jobDialogBody");
  if (!dialog || !body) return;
  body.innerHTML = html;
  if (typeof dialog.showModal === "function") dialog.showModal();
}

async function generateResumePrompt(jobId, btn) {
  const job = jobCache.get(jobId);
  btn.disabled = true; btn.textContent = "Building…";
  try {
    const { prompt } = await api("/jobs/resume-prompt", { method: "POST", body: { jobId } });
    openJobDialog(`
      <h2>Resume-tailoring prompt</h2>
      <p class="muted">Copy this, paste it into Claude or ChatGPT, then paste your resume where indicated. Nothing is sent for you.</p>
      <p class="small muted">${escapeHtml(job ? `${job.title} · ${job.company}` : "")}</p>
      <textarea id="resumePromptText" class="prompt-box" readonly rows="16">${escapeHtml(prompt)}</textarea>
      <div class="card-actions">
        <button class="btn primary" id="copyResumePrompt">Copy prompt</button>
        <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude ↗</a>
      </div>`);
    $("#copyResumePrompt")?.addEventListener("click", () => copyText(prompt, "Prompt copied — paste it with your resume."));
  } catch (err) {
    toast(`Resume prompt: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = "✎ Resume prompt";
  }
}

async function findNetworking(jobId, btn) {
  btn.disabled = true; btn.textContent = "Finding…";
  try {
    const r = await api("/jobs/networking", { method: "POST", body: { jobId } });
    const leads = (r.leads || []).map(l => `
      <li>
        <span>${escapeHtml(l.label)}</span>
        <a class="btn small" href="${escapeHtml(safeExternalUrl(l.searchUrl))}" target="_blank" rel="noopener noreferrer">Search ↗</a>
      </li>`).join("");
    openJobDialog(`
      <h2>Networking leads — ${escapeHtml(r.job?.company || "")}</h2>
      <p class="small warn-text">${escapeHtml(r.safetyNote || "Nothing is sent — review and click manually.")}</p>
      <ul class="lead-list">${leads}</ul>
      <h3>Draft connection note</h3>
      <textarea class="prompt-box" readonly rows="3">${escapeHtml(r.connectionNote || "")}</textarea>
      <div class="card-actions"><button class="btn" id="copyConnNote">Copy note</button></div>
      <h3>Draft coffee-chat message</h3>
      <textarea class="prompt-box" readonly rows="8">${escapeHtml(r.coffeeChatMessage || "")}</textarea>
      <div class="card-actions"><button class="btn" id="copyCoffee">Copy message</button></div>`);
    $("#copyConnNote")?.addEventListener("click", () => copyText(r.connectionNote, "Connection note copied."));
    $("#copyCoffee")?.addEventListener("click", () => copyText(r.coffeeChatMessage, "Message copied."));
  } catch (err) {
    toast(`Networking: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = "☕ Networking";
  }
}

function copyText(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg)).catch(() => toast("Copy failed — select the text manually."));
}

$("#jobDialog .modal-close")?.addEventListener("click", () => $("#jobDialog")?.close());
$("#jobDialog")?.addEventListener("click", (e) => { if (e.target.id === "jobDialog") e.target.close(); });

function initProfessorPanel() {
  const root = $("#professorList");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  root.innerHTML = `<div class="empty">Search official Berkeley faculty pages to find professors by research fit.</div>`;
}

async function searchProfessors() {
  const root = $("#professorList");
  const trace = $("#professorTrace");
  const btn = $("#findProfessorsBtn");
  const query = $("#professorQuery")?.value?.trim() || "";
  if (!root || !btn) return;
  btn.disabled = true;
  btn.textContent = "Searching...";
  root.innerHTML = `<div class="empty">Searching official Berkeley faculty pages...</div>`;
  if (trace) trace.hidden = true;
  try {
    const result = await api("/professors/search", { method: "POST", body: { query, limit: 12 } });
    if (trace) {
      trace.hidden = false;
      trace.innerHTML = `
        <div class="trace-head">
          <strong>Faculty search</strong>
          <span>${result.directorySize ? `${result.directorySize.toLocaleString()} faculty indexed · ` : ""}${result.count || 0} result(s)</span>
        </div>
        <div class="trace-steps">
          <span class="ok">${result.mode === "imported-berkeley-directory" ? "searched cached official Berkeley directories" : "live EECS fallback"}</span>
        </div>`;
    }
    if (!result.professors?.length) {
      root.innerHTML = `<div class="empty">No professor matches found. Try a broader research area or a professor name.</div>`;
      return;
    }
    renderProfessors(root, result.professors);
  } catch (err) {
    root.innerHTML = `<div class="empty">Professor search failed. (${esc(err.message)})</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find professors";
  }
}

const anonymousProfessorAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'%3E%3Crect width='72' height='72' fill='%23f4f4f5'/%3E%3Ccircle cx='36' cy='26' r='14' fill='%23c7c7d0'/%3E%3Cpath d='M18 64c0-10 8-18 18-18s18 8 18 18H18z' fill='%23c7c7d0'/%3E%3C/svg%3E";

function renderProfessors(root, professors) {
  root.innerHTML = professors.map((p, index) => `
    <article class="course-card professor-card" data-professor="${index}">
      <img class="professor-avatar" src="${esc(p.imageUrl || anonymousProfessorAvatar)}" alt="${esc(p.imageUrl ? p.name : "Anonymous professor")}" loading="lazy">
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="course-meta">
          ${p.title ? `<span class="tag">${esc(p.title)}</span>` : ""}
          ${(p.departments || []).slice(0, 2).map(department => `<span class="tag">${esc(department)}</span>`).join("")}
          ${p.email ? `<span class="tag">email</span>` : ""}
          <span class="tag good">Berkeley faculty page</span>
        </div>
        <p class="desc">${esc(p.field || "Research interests not listed.")}</p>
      </div>
      <div class="score-badge ${scoreClass(p.score || 0)}">
        <small>Fit</small>
        <span>${Math.round(p.score || 0)}</span>
      </div>
      <div class="card-actions">
        <button data-professor-detail="${index}">View details</button>
        ${p.source ? `<a class="btn" href="${esc(p.source)}" target="_blank" rel="noopener">Open source ↗</a>` : ""}
      </div>
    </article>`).join("");

  $$("[data-professor-detail]", root).forEach(btn => {
    btn.addEventListener("click", () => showProfessorDialog(professors[Number(btn.dataset.professorDetail)]));
  });
}

function showProfessorDialog(professor) {
  if (!professor) return;
  const dialog = $("#professorDialog");
  const body = $("#professorDialogBody");
  if (!dialog || !body) return;
  body.innerHTML = `
    <h2>${esc(professor.name)}</h2>
    ${professor.title ? `<p class="muted">${esc(professor.title)}</p>` : ""}
    <div class="modal-grid">
      <div><strong>Email</strong><span>${professor.email ? `<a href="mailto:${esc(professor.email)}">${esc(professor.email)}</a>` : "Not listed"}</span></div>
      <div><strong>Department</strong><span>${esc((professor.departments || []).join(", ") || "Not listed")}</span></div>
      <div><strong>Research field</strong><span>${esc(professor.field || "Not listed")}</span></div>
      <div><strong>Source</strong><span><a href="${esc(professor.source)}" target="_blank" rel="noopener">${esc(professor.sourceName || "Berkeley faculty page")}</a></span></div>
    </div>
    <h3>Bio</h3>
    <p>${esc(professor.bio || "No biography found on the official page.")}</p>`;
  if (typeof dialog.showModal === "function") dialog.showModal();
}

$("#professorDialog .modal-close")?.addEventListener("click", () => $("#professorDialog")?.close());
$("#professorDialog")?.addEventListener("click", (e) => {
  if (e.target.id === "professorDialog") e.target.close();
});


boot().catch(err => { console.error(err); toast(err.message); });
