CREATE TABLE IF NOT EXISTS targets (
  id            TEXT PRIMARY KEY,
  priority      INTEGER NOT NULL,
  path          TEXT NOT NULL,
  name          TEXT NOT NULL,
  lab           TEXT,
  project       TEXT,
  fit           TEXT,
  contact       TEXT,
  sentence      TEXT,
  source        TEXT,
  notes         TEXT,
  evidence      TEXT,
  score         INTEGER DEFAULT 0,
  score_facets  TEXT,
  extracted_at  TEXT,
  last_seen_at  TEXT,
  auto          INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_targets_priority ON targets(priority);
CREATE INDEX IF NOT EXISTS idx_targets_source   ON targets(source);
CREATE INDEX IF NOT EXISTS idx_targets_path     ON targets(path);

CREATE TABLE IF NOT EXISTS decisions (
  target_id   TEXT PRIMARY KEY REFERENCES targets(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  checks      TEXT,
  decided_at  TEXT,
  draft       TEXT,
  recipient   TEXT
);

CREATE TABLE IF NOT EXISTS scan_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  added       INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  error       TEXT,
  seen        TEXT
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  due_at     TEXT NOT NULL,
  note       TEXT,
  resolved   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_followups_due ON follow_ups(due_at, resolved);

CREATE TABLE IF NOT EXISTS sources (
  url      TEXT PRIMARY KEY,
  path     TEXT NOT NULL,
  kind     TEXT NOT NULL,
  name     TEXT NOT NULL,
  enabled  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS email_ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  draft       TEXT NOT NULL,
  rating      INTEGER NOT NULL,
  critique    TEXT,
  writer_mode TEXT,
  writer_model TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ratings_target ON email_ratings(target_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rating ON email_ratings(rating);

CREATE TABLE IF NOT EXISTS skill_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  skill      TEXT NOT NULL,
  target_id  TEXT,
  status     TEXT NOT NULL,
  input      TEXT,
  output     TEXT,
  error      TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_skill ON skill_runs(skill, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- College Copilot tables
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One row per user. JSON columns hold flexible lists/objects.
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  college               TEXT,
  major                 TEXT,
  grad_year             INTEGER,
  interests             TEXT,          -- JSON: string[]
  completed_courses     TEXT,          -- JSON: string[] e.g. ["COMPSCI 61A"]
  requirements_remaining TEXT,         -- JSON: string[] requirement codes/labels
  time_prefs            TEXT,          -- JSON: { earliest, latest, daysOff[] }
  workload_tolerance    TEXT,          -- 'light' | 'medium' | 'heavy'
  min_prof_rating       REAL,
  updated_at            TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id                    TEXT PRIMARY KEY,   -- e.g. "compsci-61a"
  subject               TEXT NOT NULL,      -- "COMPSCI"
  number                TEXT NOT NULL,      -- "61A"
  title                 TEXT NOT NULL,
  units                 REAL,
  description           TEXT,
  requirements_satisfied TEXT,             -- JSON: string[]
  terms_offered         TEXT,              -- JSON: string[]
  prerequisites         TEXT,              -- free-text prereq string from catalog
  avg_gpa               REAL,              -- course-level average GPA (Berkeleytime)
  updated_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_courses_subject ON courses(subject);

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT PRIMARY KEY,           -- stable hash of course+term+class_number
  course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  term          TEXT NOT NULL,             -- "fall-2026"
  class_number  TEXT,                      -- CCN
  component      TEXT,                      -- LEC / DIS / LAB
  instructor    TEXT,
  days          TEXT,                      -- "MWF" / "TuTh"
  start_min     INTEGER,                   -- minutes since midnight, null if async
  end_min       INTEGER,
  location      TEXT,
  enroll_cap    INTEGER,
  enrolled      INTEGER,
  waitlist      INTEGER,
  status        TEXT,                      -- open / waitlist / closed
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_term ON sections(term);

CREATE TABLE IF NOT EXISTS instructors (
  id                    TEXT PRIMARY KEY,   -- normalized name key
  name                  TEXT NOT NULL,
  rmp_rating            REAL,
  rmp_difficulty        REAL,
  rmp_would_take_again  REAL,
  rmp_num_ratings       INTEGER,
  avg_gpa               REAL,
  grade_distribution    TEXT,              -- JSON: { "A": n, "B": n, ... }
  fetched_at            TEXT
);

CREATE TABLE IF NOT EXISTS saved_plans (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term          TEXT NOT NULL,
  name          TEXT NOT NULL,
  section_ids   TEXT NOT NULL,             -- JSON: string[]
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_plans_user ON saved_plans(user_id, term);
