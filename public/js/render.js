import { session, drafts, recipients } from "./state.js";
import { extractEmail } from "./gmail.js";

const PATH_LABEL = { A: "Research", B: "Startup", C: "Project" };
const DECISION_LABEL = {
  pending: "pending",
  approved: "approved",
  sent: "sent",
  replied: "replied",
  no_response: "no response",
  follow_up: "follow-up",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

function filterTargets() {
  const q = el("search").value.trim().toLowerCase();
  const path = session.filters.path;
  const decision = session.filters.decision;
  return session.targets
    .filter(t => path === "All" || t.path === path)
    .filter(t => decision === "All" || t.decision === decision)
    .filter(t => !q || [t.name, t.lab, t.project, t.fit, t.sentence, t.source].join(" ").toLowerCase().includes(q));
}

function maxScoreSoFar() {
  return session.targets.reduce((acc, t) => Math.max(acc, t.score ?? 0), 0) || 1;
}

function renderCard(t, maxScore) {
  const pct = Math.min(100, Math.round(((t.score ?? 0) / maxScore) * 100));
  const facets = (t.scoreFacets || []).slice(0, 3)
    .map(f => `<span class="facet-pill"><span class="dot"></span>${escapeHtml(f.label)}</span>`)
    .join("");
  const detectedEmail = extractEmail(t.contact);
  const emailLine = detectedEmail ? `<div class="email-mini">${escapeHtml(detectedEmail)}</div>` : "";
  return `
    <div class="card${session.selectedId === t.id ? " selected" : ""}" data-id="${escapeHtml(t.id)}" tabindex="0">
      <div class="rank">${escapeHtml(t.p)}</div>
      <div class="card-main">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(t.name)}</span>
          <span class="card-path ${escapeHtml(t.path)}">${escapeHtml(PATH_LABEL[t.path] || t.path)}</span>
          ${t.auto ? `<span class="auto-tag">Auto</span>` : ""}
          ${t.followUp ? `<span class="auto-tag" title="Follow-up due ${escapeHtml(new Date(t.followUp.dueAt).toLocaleDateString())}">⏱ Snoozed</span>` : ""}
        </div>
        <div class="card-sub">${escapeHtml(t.lab ?? "")} · ${escapeHtml(t.project ?? "")}</div>
        <div class="card-fit">${escapeHtml(t.fit ?? "")}</div>
        ${facets ? `<div class="facet-bars">${facets}</div>` : ""}
      </div>
      <div class="card-side">
        <div class="score-orb" style="--pct:${pct};"><span>${escapeHtml(t.score ?? 0)}</span></div>
        <span class="decision-pill ${escapeHtml(t.decision)}">${escapeHtml(DECISION_LABEL[t.decision] || t.decision)}</span>
        ${emailLine}
      </div>
    </div>
  `;
}

export function renderQueue(handlers) {
  const queue = el("queue");
  const visible = filterTargets();
  const maxScore = maxScoreSoFar();
  queue.innerHTML = visible.length
    ? visible.map(t => renderCard(t, maxScore)).join("")
    : `<div class="card" style="text-align:center;color:var(--muted);grid-template-columns:1fr;">No targets match these filters.</div>`;
  for (const node of queue.querySelectorAll(".card[data-id]")) {
    const id = node.getAttribute("data-id");
    const target = session.targets.find(t => t.id === id);
    if (!target) continue;
    node.addEventListener("click", () => handlers.onSelect(target));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handlers.onSelect(target);
      }
    });
  }
  renderMetrics();
}

export function renderMetrics() {
  const targets = session.targets;
  el("totalCount").textContent = String(targets.length);
  el("approvedCount").textContent = String(targets.filter(t => ["approved", "sent", "replied", "no_response", "follow_up"].includes(t.decision)).length);
  el("researchCount").textContent = String(targets.filter(t => t.path === "A").length);
  el("startupCount").textContent = String(targets.filter(t => t.path === "B").length);
  el("autoCount").textContent = String(targets.filter(t => t.auto).length);
}

export function renderAgentStatus() {
  const node = el("agentStatus");
  if (!session.backendAvailable) {
    node.className = "agent-status offline";
    node.innerHTML = `<span class="status-pill">Offline</span><span>Backend not connected. Run <code>npm run dev</code> from the project root.</span>`;
    return;
  }
  const s = session.scanStatus;
  const isScanning = !!s?.scanning;
  node.className = `agent-status ${isScanning ? "scanning" : "idle"}`;
  const last = s?.lastScanFinishedAt ? new Date(s.lastScanFinishedAt).toLocaleString() : "never";
  const totalSources = s?.totalSources || 0;
  const done = (s?.progress || []).length;
  const pct = totalSources ? Math.min(100, (done / totalSources) * 100) : (isScanning ? 8 : 0);
  const feed = (s?.progress || []).slice(-12).map(item => {
    const cls = item.status === "matched" ? "matched" : item.status === "error" ? "error" : "ignored";
    const label = item.name || new URL(item.source || "http://x").hostname;
    return `<span class="feed-item ${cls}">${escapeHtml(label)}</span>`;
  }).join("");
  node.innerHTML = `
    <span class="status-pill">${isScanning ? "Scanning" : "Idle"}</span>
    <span>${isScanning ? `${done}/${totalSources} sources` : `Last scan: ${escapeHtml(last)}`}</span>
    <span>Added ${s?.lastScanAdded ?? 0} · Updated ${s?.lastScanUpdated ?? 0}</span>
    <span class="progress-bar"><span style="width:${pct}%"></span></span>
    ${s?.lastScanError ? `<span style="color:var(--danger)">${escapeHtml(s.lastScanError)}</span>` : ""}
    ${isScanning && feed ? `<div class="scan-feed">${feed}</div>` : ""}
  `;
}

export function renderDetail(target, handlers) {
  const body = el("panelBody");
  const empty = el("panelEmpty");
  if (!target) {
    body.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.hidden = false;

  el("detailTitle").textContent = target.name;
  el("rankPill").textContent = `#${target.p}`;
  const sourceLink = target.source
    ? `<a href="${escapeHtml(target.source)}" target="_blank" rel="noreferrer">Open source ↗</a>`
    : "";
  const path = PATH_LABEL[target.path] || target.path;
  el("detailMeta").innerHTML = `
    <strong>${escapeHtml(path)}</strong> · ${escapeHtml(target.lab ?? "")}<br>
    ${escapeHtml(target.project ?? "")}<br>
    ${sourceLink}${target.contact ? ` · ${escapeHtml(target.contact)}` : ""}
  `;
  const facets = (target.scoreFacets || []);
  el("detailFacets").innerHTML = facets
    .map(f => `<span class="facet-pill"><span class="dot"></span>${escapeHtml(f.label)}</span>`)
    .join("");
  const evidenceBlock = el("evidenceBlock");
  if (target.evidence) {
    evidenceBlock.hidden = false;
    el("evidenceText").textContent = target.evidence;
  } else {
    evidenceBlock.hidden = true;
  }

  const draftText = drafts.get(target.id) || target.draftDraft || handlers.fallbackDraft(target);
  const recipient = recipients.get(target.id) || target.recipient || extractEmail(target.contact);
  el("draft").value = draftText;
  el("recipientInput").value = recipient;
  el("outreachStatus").value = target.decision;

  el("criticBadge").hidden = true;
  el("criticDetail").hidden = true;
  highlightRating(0);
  el("ratingCritique").value = "";
  el("ratingNote").textContent = "";

  const detectedEmail = extractEmail(target.contact);
  const emailChip = el("emailChip");
  if (detectedEmail && detectedEmail !== recipient) {
    emailChip.hidden = false;
    emailChip.textContent = `Use ${detectedEmail}`;
    emailChip.onclick = () => {
      el("recipientInput").value = detectedEmail;
      recipients.set(target.id, detectedEmail);
      emailChip.hidden = true;
      updateDraftButtons();
    };
  } else {
    emailChip.hidden = true;
  }

  updateDraftButtons();
}

export function updateDraftButtons() {
  const target = session.targets.find(t => t.id === session.selectedId);
  const rewriteBtn = el("rewriteBtn");
  const finalBtn = el("finalActionBtn");
  const markSentBtn = el("markSentBtn");
  const snoozeBtn = el("snoozeBtn");
  const statusSelect = el("outreachStatus");
  const saveBtn = el("saveStatusBtn");
  const editedPill = el("editedPill");
  const note = el("approvalNote");

  rewriteBtn.disabled = !target || !session.backendAvailable;
  markSentBtn.disabled = !target;
  snoozeBtn.disabled = !target || !session.backendAvailable;
  statusSelect.disabled = !target;
  saveBtn.disabled = !target;
  finalBtn.disabled = !target;

  if (!target) return;
  editedPill.classList.toggle("visible", !!drafts.get(target.id));
  const recipientValue = el("recipientInput").value || target.contact || "";
  const hasEmail = !!extractEmail(recipientValue);
  finalBtn.textContent = hasEmail ? "Open in Gmail" : "Open source page";
  note.textContent = hasEmail
    ? "The green button opens Gmail compose with this draft pre-filled. Nothing sends automatically."
    : "No email detected — green button opens the source page instead.";
}

export function renderCritic(result) {
  const badge = el("criticBadge");
  const detail = el("criticDetail");
  const dims = el("criticDims");
  const issues = el("criticIssues");
  if (!result || !result.critic) {
    badge.hidden = true;
    detail.hidden = true;
    return;
  }
  const c = result.critic;
  badge.hidden = false;
  badge.textContent = `Critic ${c.score}/5${c.mode === "heuristic" ? " (heur)" : ""}`;
  badge.className = "critic-badge" + (c.score <= 2 ? " bad" : c.score === 3 ? " warn" : "");
  detail.hidden = false;
  dims.innerHTML = Object.entries(c.dimensions).map(([k, v]) => `
    <div class="critic-dim">
      <span>${escapeHtml(k.replace(/_/g, " "))}</span>
      <span class="bar"><span style="width:${(v / 5) * 100}%"></span></span>
    </div>
  `).join("");
  issues.innerHTML = (c.issues || []).length
    ? `<span><strong>${escapeHtml(c.verdict || "")}</strong></span>` +
      (c.issues || []).map(i => `<span>• ${escapeHtml(i)}</span>`).join("")
    : `<span>${escapeHtml(c.verdict || "Looks good.")}</span>`;
}

export function renderSkills(skills) {
  const grid = el("skillsGrid");
  grid.innerHTML = skills.map(s => `
    <div class="skill-card ${escapeHtml(s.status)}">
      <h4>${escapeHtml(s.name)} <span class="skill-status ${escapeHtml(s.status)}">${escapeHtml(s.status)}</span></h4>
      <p>${escapeHtml(s.description)}</p>
      ${s.recentRuns?.length ? `<div class="skill-runs">${
        s.recentRuns.map(r => `<span class="run ${escapeHtml(r.status)}" title="${escapeHtml(r.error || "")}">${escapeHtml(r.status)} · ${escapeHtml(r.durationMs)}ms</span>`).join("")
      }</div>` : ""}
    </div>
  `).join("");
}

export function renderAgents(agents, skills) {
  const grid = el("agentsGrid");
  const skillStatusByName = new Map((skills || []).map(s => [s.name, s.status]));
  grid.innerHTML = agents.map(a => {
    const skillPills = (a.skills || []).map(name => {
      const status = skillStatusByName.get(name);
      const cls = status === "active" ? "active" : status === "stub" ? "stub" : "missing";
      const label = status ?? "missing";
      return `<span class="agent-skill-pill ${cls}" title="${escapeHtml(label)}">${escapeHtml(name)}</span>`;
    }).join("");
    return `
      <div class="agent-card ${escapeHtml(a.status)}">
        <h4>${escapeHtml(a.name)} <span class="skill-status ${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></h4>
        <p>${escapeHtml(a.description)}</p>
        <div class="agent-skills-label">Skills used every run</div>
        <div class="agent-skills">${skillPills || `<span class="agent-skill-pill">none declared</span>`}</div>
      </div>
    `;
  }).join("");
}

export function highlightRating(rating) {
  for (const btn of document.querySelectorAll(".thumb")) {
    btn.classList.toggle("active", Number(btn.getAttribute("data-rating")) === rating);
  }
}
