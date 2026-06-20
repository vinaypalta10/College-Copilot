async function request(path, init = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch { /* ignore */ }
    throw new Error(`${response.status} ${detail.slice(0, 200)}`);
  }
  return response.json();
}

export const api = {
  listTargets: () => request("/api/targets"),
  quickAdd: (url) =>
    request("/api/targets/from-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  scanStatus: () => request("/api/scan/status"),
  startScan: () => request("/api/scan", { method: "POST" }),
  patchDecision: (targetId, body) =>
    request(`/api/decisions/${encodeURIComponent(targetId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  bulkDecisions: (decisions) =>
    request("/api/decisions", {
      method: "POST",
      body: JSON.stringify({ decisions }),
    }),
  writeEmail: (targetId, currentDraft) =>
    request("/api/write-email", {
      method: "POST",
      body: JSON.stringify({ targetId, currentDraft }),
    }),
  snooze: (targetId, dueAt, note) =>
    request("/api/followups", {
      method: "POST",
      body: JSON.stringify({ targetId, dueAt, note }),
    }),
  resolveFollowUp: (id) =>
    request(`/api/followups/${id}`, { method: "DELETE" }),
  postRating: (targetId, body) =>
    request(`/api/ratings/${encodeURIComponent(targetId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listSkills: () => request("/api/skills"),
  runSkill: (name, input, targetId) =>
    request(`/api/skills/${encodeURIComponent(name)}/run`, {
      method: "POST",
      body: JSON.stringify({ input, targetId }),
    }),
  listAgents: () => request("/api/agents"),
  runAgent: (name, input, targetId) =>
    request(`/api/agents/${encodeURIComponent(name)}/run`, {
      method: "POST",
      body: JSON.stringify({ input, targetId }),
    }),
};
