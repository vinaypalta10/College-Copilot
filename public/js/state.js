const DRAFT_KEY = "ruoxi_outreach_draft_edits";
const RECIPIENT_KEY = "ruoxi_outreach_recipients";
const THEME_KEY = "ruoxi_outreach_theme";

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}

export const drafts = {
  get(id) { return readJson(DRAFT_KEY)[id] || ""; },
  set(id, value) {
    const all = readJson(DRAFT_KEY);
    all[id] = value;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  },
  clear(id) {
    const all = readJson(DRAFT_KEY);
    delete all[id];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  },
};

export const recipients = {
  get(id) { return readJson(RECIPIENT_KEY)[id] || ""; },
  set(id, value) {
    const all = readJson(RECIPIENT_KEY);
    all[id] = value;
    localStorage.setItem(RECIPIENT_KEY, JSON.stringify(all));
  },
};

export const theme = {
  get() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },
  set(value) {
    localStorage.setItem(THEME_KEY, value);
  },
};

export const session = {
  targets: [],
  selectedId: null,
  backendAvailable: false,
  scanStatus: null,
  filters: { path: "All", decision: "All" },
};
