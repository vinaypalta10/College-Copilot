const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "targets.json");
const sourcesPath = path.join(dataDir, "sources.json");
const csvPath = path.join(root, "summer_2026_targets.csv");
const port = Number(process.env.PORT || 4174);
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS || 6 * 60 * 60 * 1000);
const writerModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const profile = {
  proof: [
    "BAIR AgentHLE benchmark for LLM agents in private-equity workflows",
    "Postmortem Memory Agent with retrieval over alerts, postmortems, code diffs, and recurring failures",
    "GeneLLM reproducible PyTorch experiment runner for comparable model variants",
    "Lean 4 and multi-agent proof-system work around verifiable reasoning"
  ],
  keywords: [
    "agent", "agents", "llm", "evaluation", "benchmark", "benchmarks", "workflow",
    "automation", "retrieval", "memory", "inference", "serving", "systems",
    "failure", "trajectory", "tool", "function calling", "reliability", "eval"
  ]
};

const state = {
  scanning: false,
  lastScanStartedAt: null,
  lastScanFinishedAt: null,
  lastScanError: null,
  lastScanAdded: 0,
  lastScanUpdated: 0,
  scanCount: 0
};

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    const rows = parseCsv(await fs.readFile(csvPath, "utf8"));
    const targets = rows.map((row, index) => ({
      id: stableId(`seed:${row.Name}:${row["Source URL"] || index}`),
      p: Number(row.Priority) || index + 1,
      path: row.Path || "A",
      name: row.Name,
      lab: row["Lab or Company"],
      project: row["Role/Project"],
      fit: row["Why fit"],
      contact: row["Email or Apply"],
      sentence: row["Specific sentence to mention"],
      source: row["Source URL"],
      notes: row.Notes || "",
      status: row.Status || "Needs review",
      extractedAt: new Date().toISOString(),
      lastSeenAt: null,
      score: scoreText([row.Name, row["Lab or Company"], row["Role/Project"], row["Why fit"], row["Specific sentence to mention"]].join(" ")),
      evidence: row["Specific sentence to mention"] || ""
    }));
    await writeJson(dbPath, { targets, decisions: {}, scanLog: [] });
  }
  try {
    await fs.access(sourcesPath);
  } catch {
    await writeJson(sourcesPath, defaultSources());
  }
}

function defaultSources() {
  return [
    { path: "A", kind: "research", name: "Sky MAST", url: "https://sky.cs.berkeley.edu/project/mast/" },
    { path: "A", kind: "research", name: "Sky Search Arena", url: "https://sky.cs.berkeley.edu/project/search-arena/" },
    { path: "A", kind: "research", name: "Gorilla BFCL", url: "https://gorilla.cs.berkeley.edu/" },
    { path: "A", kind: "research", name: "Berkeley RDI AgentX", url: "https://rdi.berkeley.edu/agentx/" },
    { path: "B", kind: "startup", name: "Dex YC job", url: "https://www.ycombinator.com/companies/joindex/jobs/jgOpS9K-2026-summer-ai-ml-engineer-intern" },
    { path: "B", kind: "startup", name: "PathPilot YC job", url: "https://www.ycombinator.com/companies/pathpilot/jobs/ior8myx-summer-2026-internship" },
    { path: "B", kind: "startup", name: "SafetyKit YC job", url: "https://www.ycombinator.com/companies/safetykit/jobs/eQpUzRD-full-stack-engineer-intern-summer-2026" },
    { path: "B", kind: "startup", name: "SID YC job", url: "https://www.ycombinator.com/companies/sid/jobs/SmhVhTs-research-intern-summer-2026" },
    { path: "C", kind: "benchmark", name: "Scale Labs", url: "https://labs.scale.com/" },
    { path: "C", kind: "benchmark", name: "Arcline Agentic AI", url: "https://www.eduarcline.us/careers/agentic-ai-rd-intern" },
    { path: "C", kind: "benchmark", name: "Aegean Summer of Agents", url: "https://aegean.ai/careers/virtual-internships/summer-of-agents-2026" }
  ];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === "\"" && next === "\"") {
      cell += "\"";
      i++;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
}

function stableId(input) {
  let hash = 2166136261;
  for (const ch of input) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `t_${(hash >>> 0).toString(16)}`;
}

function scoreText(text) {
  const lower = text.toLowerCase();
  return profile.keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html, fallback) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (title || fallback || "Opportunity").replace(/\s+/g, " ").trim();
}

function evidenceSnippet(text) {
  const lower = text.toLowerCase();
  const hits = profile.keywords
    .map(k => lower.indexOf(k))
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  const start = Math.max(0, (hits[0] || 0) - 160);
  return text.slice(start, start + 360).trim();
}

function inferTarget(source, html) {
  const text = cleanHtml(html);
  const title = pageTitle(html, source.name);
  const score = scoreText(`${title} ${text}`);
  if (score < 3) return null;
  const lower = `${title} ${text}`.toLowerCase();
  const isJob = /intern|internship|engineer|summer|apply|career|job/.test(lower) || source.kind === "startup";
  const pathName = source.path || (isJob ? "B" : "A");
  const project = title.replace(/\s*\|\s*Y Combinator.*$/i, "").replace(/\s+-\s+.*Careers.*$/i, "");
  const name = source.kind === "startup" ? source.name.replace(/\s+YC job$/i, "") : source.name;
  const fit = pathName === "B"
    ? "Extracted match for agent/workflow engineering, evaluation, infrastructure, or product internship work"
    : "Extracted match for agents, LLM evaluation, benchmarking, ML systems, or workflow automation";
  const sentence = pathName === "B"
    ? `I was interested in ${name} because the role appears to involve ${keywordPhrase(lower)}, which connects to my agent evaluation and workflow-systems background.`
    : `I was especially interested in ${project} because it touches ${keywordPhrase(lower)}, which connects to my BAIR benchmark and Postmortem Memory Agent work.`;
  return {
    id: stableId(`auto:${source.url}`),
    path: pathName,
    name,
    lab: source.kind === "startup" ? "Startup / company" : "Research lab / project",
    project,
    fit,
    contact: pathName === "B" || isJob ? "Apply via source page" : "Need verify email",
    sentence,
    source: source.url,
    notes: "Auto-extracted by local scanner; verify source details before approving.",
    status: "Needs review",
    score,
    evidence: evidenceSnippet(text),
    extractedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
}

function keywordPhrase(lower) {
  const hits = profile.keywords.filter(keyword => lower.includes(keyword)).slice(0, 4);
  return hits.length ? hits.join(", ") : "agent reliability and evaluation";
}

function outputTextFromResponse(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function inferPaperQuestion(target) {
  const project = target.project || "your work";
  const lower = `${target.project || ""} ${target.evidence || ""} ${target.sentence || ""}`.toLowerCase();
  if (lower.includes("mast") || lower.includes("failure taxonomy")) {
    return "I was wondering how you decided which failure modes should be separate categories rather than grouped under a broader agent-planning or coordination failure.";
  }
  if (lower.includes("search arena")) {
    return "I was curious how you separate failures caused by retrieval quality from failures caused by how the model uses retrieved evidence.";
  }
  if (lower.includes("bfcl") || lower.includes("function") || lower.includes("tool")) {
    return "I was curious how you chose the boundary between an invalid tool call and a tool call that is syntactically valid but not useful for the task.";
  }
  if (lower.includes("agent") || lower.includes("benchmark")) {
    return "I was curious how you decide whether a benchmark item is measuring the agent's reasoning ability versus the surrounding system design.";
  }
  return `I was curious about one design choice in ${project}: how you decided what to evaluate directly versus what to leave as qualitative failure analysis.`;
}

function localRelationshipDraft(target) {
  const firstName = String(target.name || "there").split(/\s+/)[0];
  const project = target.project || "your recent work";
  const question = inferPaperQuestion(target);
  const topic = target.path === "A"
    ? "agent evaluation and reliability"
    : "reliable agent workflows";
  return `Subject: Question about ${project}\n\nHi ${firstName},\n\nI'm Ruoxi Wu, a UC Berkeley Data Science undergrad. I've been trying to understand ${topic} better, and in doing so came across your work on ${project}.\n\n${question}\n\nI'm asking because I have been working on evaluation setups for LLM agents, and this part of your methodology seems closely related to the question of how to make agent failures concrete enough to study rather than just describe after the fact.\n\nWould you be open to a 20-30 minute chat sometime next week? I'd be happy to meet over Zoom or come by in person if that is easier.\n\nBest,\nRuoxi`;
}

async function writeEmailDraft(payload) {
  const target = payload.target || {};
  const currentDraft = payload.currentDraft || "";
  if (!process.env.OPENAI_API_KEY) {
    return {
      draft: localRelationshipDraft(target),
      mode: "local",
      note: "OPENAI_API_KEY is not set, so the local relationship-first writer was used."
    };
  }

  const instructions = [
    "You are a cold-email writing agent for an undergraduate contacting PhD students or research staff.",
    "Write like a real student: concise, warm, specific, low-pressure, and not over-polished.",
    "Use the relationship-first method: introduce name/year/major, show interest through action, ask one thoughtful question about their paper/project, invite a 20-30 minute chat.",
    "Do not pitch a research position directly. Do not attach or mention a resume. Do not list experience bullets.",
    "Subtly mention Ruoxi has worked on LLM agent evaluation only if it makes the question feel grounded.",
    "Avoid hype, flattery, generic AI interest, and phrases like 'I am passionate about'.",
    "Return only the email, including a Subject line."
  ].join(" ");

  const input = {
    target: {
      name: target.name,
      lab: target.lab,
      project: target.project,
      fit: target.fit,
      sentence: target.sentence,
      evidence: target.evidence,
      source: target.source
    },
    ruoxi_profile: {
      school: "UC Berkeley",
      major: "Data Science",
      relevant_work: profile.proof
    },
    current_draft: currentDraft,
    requested_style: "human, relationship-first, asks a paper/project question before asking for any opportunity"
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: writerModel,
      instructions,
      input: JSON.stringify(input, null, 2),
      max_output_tokens: 700,
      text: { verbosity: "low" }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI writer failed: HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  const draft = outputTextFromResponse(data);
  if (!draft) throw new Error("OpenAI writer returned no text");
  return { draft, mode: "openai", model: writerModel };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function loadDb() {
  const db = await readJson(dbPath, { targets: [], decisions: {}, scanLog: [] });
  let changed = false;
  const seen = new Set();
  const nonAutoSources = new Set(
    (db.targets || [])
      .filter(target => !String(target.notes || "").startsWith("Auto-extracted"))
      .map(target => target.source)
      .filter(Boolean)
  );
  const autoSources = new Set();
  db.targets = (db.targets || []).map((target, index) => {
    const source = target.source || "";
    const baseId = String(target.id || "");
    const collision = !baseId || seen.has(baseId);
    const sourceOnlySeed = baseId === stableId(source);
    if (collision || sourceOnlySeed) {
      target.id = stableId(`seed:${target.name || "target"}:${source || index}`);
      changed = true;
    }
    if (seen.has(target.id)) {
      target.id = stableId(`seed:${target.name || "target"}:${source || index}:${index}`);
      changed = true;
    }
    seen.add(target.id);
    target.p = Number(target.p) || index + 1;
    return target;
  }).filter(target => {
    const isAuto = String(target.notes || "").startsWith("Auto-extracted");
    if (isAuto && nonAutoSources.has(target.source)) {
      changed = true;
      return false;
    }
    if (isAuto && autoSources.has(target.source)) {
      changed = true;
      return false;
    }
    if (isAuto) autoSources.add(target.source);
    return true;
  }).map((target, index) => ({ ...target, p: index + 1 }));
  if (changed) await writeJson(dbPath, db);
  return db;
}

async function runScan() {
  if (state.scanning) return { skipped: true, reason: "Scan already running" };
  state.scanning = true;
  state.lastScanStartedAt = new Date().toISOString();
  state.lastScanError = null;
  let added = 0;
  let updated = 0;
  const seen = [];
  try {
    await ensureData();
    const db = await loadDb();
    const sources = await readJson(sourcesPath, defaultSources());
    const byId = new Map(db.targets.map(target => [target.id, target]));
    for (const source of sources) {
      try {
        const response = await fetch(source.url, { headers: { "user-agent": "RuoxiOutreachScanner/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const target = inferTarget(source, html);
        if (!target) {
          seen.push({ source: source.url, status: "ignored", reason: "Low keyword score" });
          continue;
        }
        const sourceMatches = db.targets.filter(existing => existing.source === source.url);
        if (sourceMatches.length) {
          for (const existing of sourceMatches) {
            Object.assign(existing, {
              score: Math.max(existing.score || 0, target.score),
              evidence: target.evidence || existing.evidence,
              lastSeenAt: target.lastSeenAt
            });
          }
          updated += sourceMatches.length;
        } else if (byId.has(target.id)) {
          Object.assign(byId.get(target.id), {
            score: target.score,
            evidence: target.evidence,
            lastSeenAt: target.lastSeenAt,
            sentence: target.sentence || byId.get(target.id).sentence
          });
          updated++;
        } else {
          target.p = db.targets.length + added + 1;
          db.targets.push(target);
          byId.set(target.id, target);
          added++;
        }
        seen.push({ source: source.url, status: "matched", score: target.score, name: target.name });
      } catch (error) {
        seen.push({ source: source.url, status: "error", error: error.message });
      }
    }
    state.lastScanAdded = added;
    state.lastScanUpdated = updated;
    state.scanCount++;
    state.lastScanFinishedAt = new Date().toISOString();
    db.scanLog = [{ at: state.lastScanFinishedAt, added, updated, seen }, ...(db.scanLog || [])].slice(0, 20);
    await writeJson(dbPath, db);
    return { added, updated, seen };
  } catch (error) {
    state.lastScanError = error.message;
    throw error;
  } finally {
    state.scanning = false;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".html" ? "text/html" : ext === ".csv" ? "text/csv" : ext === ".js" ? "application/javascript" : "text/plain";
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureData();
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, state);
    }
    if (req.method === "GET" && url.pathname === "/api/targets") {
      const db = await loadDb();
      return sendJson(res, 200, db);
    }
    if (req.method === "POST" && url.pathname === "/api/scan") {
      runScan().catch(error => {
        state.lastScanError = error.message;
      });
      return sendJson(res, 202, { ok: true, status: "scan_started" });
    }
    if (req.method === "POST" && url.pathname === "/api/decisions") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const db = await loadDb();
      db.decisions = payload.decisions || {};
      await writeJson(dbPath, db);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/write-email") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await writeEmailDraft(payload);
      return sendJson(res, 200, { ok: true, ...result });
    }
    return serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Outreach agent running at http://localhost:${port}`);
  console.log(`Scanning ${defaultSources().length} seed sources every ${Math.round(scanIntervalMs / 60000)} minutes.`);
});

setInterval(() => {
  runScan().catch(error => {
    state.lastScanError = error.message;
  });
}, scanIntervalMs);

setTimeout(() => {
  runScan().catch(error => {
    state.lastScanError = error.message;
  });
}, 1500);
