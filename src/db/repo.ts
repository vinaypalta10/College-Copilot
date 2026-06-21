import type { DB } from "./client.ts";

export interface TargetRow {
  id: string;
  user_id: string | null;
  priority: number;
  path: string;
  name: string;
  lab: string | null;
  project: string | null;
  fit: string | null;
  contact: string | null;
  sentence: string | null;
  source: string | null;
  notes: string | null;
  evidence: string | null;
  score: number;
  score_facets: string | null;
  extracted_at: string | null;
  last_seen_at: string | null;
  auto: number;
  category: string | null;   // 'research' | 'industry'
}

export interface DecisionRow {
  target_id: string;
  status: string;
  checks: string | null;
  decided_at: string | null;
  draft: string | null;
  recipient: string | null;
}

export interface ScanLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  added: number;
  updated: number;
  error: string | null;
  seen: string | null;
}

export interface SourceRow {
  url: string;
  path: string;
  kind: string;
  name: string;
  enabled: number;
  category: string | null;   // 'research' | 'industry'
}

export interface FollowUpRow {
  id: number;
  target_id: string;
  due_at: string;
  note: string | null;
  resolved: number;
  created_at: string;
}

export interface RatingRow {
  id: number;
  target_id: string;
  draft: string;
  rating: number;
  critique: string | null;
  writer_mode: string | null;
  writer_model: string | null;
  created_at: string;
}

export interface SkillRunRow {
  id: number;
  skill: string;
  target_id: string | null;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export interface UserRow {
  id: string;
  google_sub: string | null;
  email: string;
  name: string | null;
  created_at: string;
}

export interface SessionRow {
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface StudentProfileRow {
  user_id: string;
  college: string | null;
  major: string | null;
  grad_year: number | null;
  interests: string | null;
  completed_courses: string | null;
  requirements_remaining: string | null;
  time_prefs: string | null;
  workload_tolerance: string | null;
  min_prof_rating: number | null;
  updated_at: string | null;
}

export interface CourseRow {
  id: string;
  subject: string;
  number: string;
  title: string;
  units: number | null;
  description: string | null;
  requirements_satisfied: string | null;
  terms_offered: string | null;
  prerequisites: string | null;
  avg_gpa: number | null;
  updated_at: string | null;
}

export interface SectionRow {
  id: string;
  course_id: string;
  term: string;
  class_number: string | null;
  component: string | null;
  instructor: string | null;
  days: string | null;
  start_min: number | null;
  end_min: number | null;
  location: string | null;
  enroll_cap: number | null;
  enrolled: number | null;
  waitlist: number | null;
  status: string | null;
  updated_at: string | null;
}

export interface InstructorRow {
  id: string;
  name: string;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_would_take_again: number | null;
  rmp_num_ratings: number | null;
  avg_gpa: number | null;
  grade_distribution: string | null;
  fetched_at: string | null;
}

export interface SavedPlanRow {
  id: string;
  user_id: string;
  term: string;
  name: string;
  section_ids: string;
  created_at: string;
}

export class Repo {
  constructor(private readonly db: DB) {}

  // ─── Users & sessions ───
  upsertUserByGoogle(input: { id: string; google_sub: string; email: string; name: string | null }): UserRow {
    this.db.prepare(`
      INSERT INTO users (id, google_sub, email, name, created_at)
      VALUES (@id, @google_sub, @email, @name, @created_at)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email,
        name  = COALESCE(excluded.name, users.name)
    `).run({ ...input, created_at: new Date().toISOString() });
    return this.db.prepare(`SELECT * FROM users WHERE google_sub = ?`).get(input.google_sub) as UserRow;
  }

  getUser(id: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  }

  createSession(token: string, userId: string, expiresAt: string): void {
    this.db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, expiresAt, new Date().toISOString());
  }

  getSession(token: string): SessionRow | undefined {
    return this.db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token) as SessionRow | undefined;
  }

  deleteSession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }

  // ─── Student profiles ───
  getProfile(userId: string): StudentProfileRow | undefined {
    return this.db.prepare(`SELECT * FROM student_profiles WHERE user_id = ?`).get(userId) as StudentProfileRow | undefined;
  }

  upsertProfile(p: StudentProfileRow): void {
    this.db.prepare(`
      INSERT INTO student_profiles (
        user_id, college, major, grad_year, interests, completed_courses,
        requirements_remaining, time_prefs, workload_tolerance, min_prof_rating, updated_at
      ) VALUES (
        @user_id, @college, @major, @grad_year, @interests, @completed_courses,
        @requirements_remaining, @time_prefs, @workload_tolerance, @min_prof_rating, @updated_at
      )
      ON CONFLICT(user_id) DO UPDATE SET
        college = excluded.college,
        major = excluded.major,
        grad_year = excluded.grad_year,
        interests = excluded.interests,
        completed_courses = excluded.completed_courses,
        requirements_remaining = excluded.requirements_remaining,
        time_prefs = excluded.time_prefs,
        workload_tolerance = excluded.workload_tolerance,
        min_prof_rating = excluded.min_prof_rating,
        updated_at = excluded.updated_at
    `).run(p);
  }

  // ─── Courses & sections ───
  upsertCourse(c: CourseRow): void {
    this.db.prepare(`
      INSERT INTO courses (
        id, subject, number, title, units, description,
        requirements_satisfied, terms_offered, prerequisites, avg_gpa, updated_at
      ) VALUES (
        @id, @subject, @number, @title, @units, @description,
        @requirements_satisfied, @terms_offered, @prerequisites, @avg_gpa, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        number = excluded.number,
        title = excluded.title,
        units = excluded.units,
        description = excluded.description,
        requirements_satisfied = excluded.requirements_satisfied,
        terms_offered = excluded.terms_offered,
        prerequisites = excluded.prerequisites,
        avg_gpa = excluded.avg_gpa,
        updated_at = excluded.updated_at
    `).run(c);
  }

  getCourse(id: string): CourseRow | undefined {
    return this.db.prepare(`SELECT * FROM courses WHERE id = ?`).get(id) as CourseRow | undefined;
  }

  listCourses(): CourseRow[] {
    return this.db.prepare(`SELECT * FROM courses ORDER BY subject, number`).all() as CourseRow[];
  }

  listCourseSubjects(): string[] {
    return (this.db.prepare(`SELECT DISTINCT subject FROM courses ORDER BY subject`).all() as Array<{ subject: string }>)
      .map(row => row.subject);
  }

  countCourses(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM courses`).get() as { n: number }).n;
  }

  upsertSection(s: SectionRow): void {
    this.db.prepare(`
      INSERT INTO sections (
        id, course_id, term, class_number, component, instructor, days,
        start_min, end_min, location, enroll_cap, enrolled, waitlist, status, updated_at
      ) VALUES (
        @id, @course_id, @term, @class_number, @component, @instructor, @days,
        @start_min, @end_min, @location, @enroll_cap, @enrolled, @waitlist, @status, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        instructor = excluded.instructor,
        days = excluded.days,
        start_min = excluded.start_min,
        end_min = excluded.end_min,
        location = excluded.location,
        enroll_cap = excluded.enroll_cap,
        enrolled = excluded.enrolled,
        waitlist = excluded.waitlist,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(s);
  }

  sectionsForCourse(courseId: string, term: string): SectionRow[] {
    return this.db.prepare(`SELECT * FROM sections WHERE course_id = ? AND term = ?`).all(courseId, term) as SectionRow[];
  }

  sectionsForTerm(term: string): SectionRow[] {
    return this.db.prepare(`SELECT * FROM sections WHERE term = ?`).all(term) as SectionRow[];
  }

  // ─── Instructors (RMP / grade cache) ───
  upsertInstructor(i: InstructorRow): void {
    this.db.prepare(`
      INSERT INTO instructors (
        id, name, rmp_rating, rmp_difficulty, rmp_would_take_again,
        rmp_num_ratings, avg_gpa, grade_distribution, fetched_at
      ) VALUES (
        @id, @name, @rmp_rating, @rmp_difficulty, @rmp_would_take_again,
        @rmp_num_ratings, @avg_gpa, @grade_distribution, @fetched_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        rmp_rating = excluded.rmp_rating,
        rmp_difficulty = excluded.rmp_difficulty,
        rmp_would_take_again = excluded.rmp_would_take_again,
        rmp_num_ratings = excluded.rmp_num_ratings,
        avg_gpa = COALESCE(excluded.avg_gpa, instructors.avg_gpa),
        grade_distribution = COALESCE(excluded.grade_distribution, instructors.grade_distribution),
        fetched_at = excluded.fetched_at
    `).run(i);
  }

  getInstructor(id: string): InstructorRow | undefined {
    return this.db.prepare(`SELECT * FROM instructors WHERE id = ?`).get(id) as InstructorRow | undefined;
  }

  // ─── Saved plans ───
  createSavedPlan(p: SavedPlanRow): void {
    this.db.prepare(`
      INSERT INTO saved_plans (id, user_id, term, name, section_ids, created_at)
      VALUES (@id, @user_id, @term, @name, @section_ids, @created_at)
    `).run(p);
  }

  listSavedPlans(userId: string): SavedPlanRow[] {
    return this.db.prepare(`SELECT * FROM saved_plans WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as SavedPlanRow[];
  }

  deleteSavedPlan(id: string, userId: string): void {
    this.db.prepare(`DELETE FROM saved_plans WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  upsertTarget(row: TargetRow): void {
    this.db.prepare(`
      INSERT INTO targets (
        id, user_id, priority, path, name, lab, project, fit, contact, sentence,
        source, notes, evidence, score, score_facets, extracted_at, last_seen_at, auto, category
      ) VALUES (
        @id, @user_id, @priority, @path, @name, @lab, @project, @fit, @contact, @sentence,
        @source, @notes, @evidence, @score, @score_facets, @extracted_at, @last_seen_at, @auto, @category
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id       = excluded.user_id,
        priority      = excluded.priority,
        path          = excluded.path,
        name          = excluded.name,
        lab           = excluded.lab,
        project       = excluded.project,
        fit           = excluded.fit,
        contact       = excluded.contact,
        sentence      = excluded.sentence,
        source        = excluded.source,
        notes         = excluded.notes,
        evidence      = COALESCE(excluded.evidence, targets.evidence),
        score         = MAX(excluded.score, targets.score),
        score_facets  = excluded.score_facets,
        last_seen_at  = excluded.last_seen_at,
        auto          = excluded.auto,
        category      = excluded.category
    `).run(row);
  }

  listTargets(): TargetRow[] {
    return this.db.prepare(`SELECT * FROM targets ORDER BY priority ASC`).all() as TargetRow[];
  }

  getTarget(id: string): TargetRow | undefined {
    return this.db.prepare(`SELECT * FROM targets WHERE id = ?`).get(id) as TargetRow | undefined;
  }

  getTargetForUser(id: string, userId: string): TargetRow | undefined {
    return this.db.prepare(`SELECT * FROM targets WHERE id = ? AND user_id = ?`).get(id, userId) as TargetRow | undefined;
  }

  getTargetBySource(source: string): TargetRow | undefined {
    return this.db.prepare(`SELECT * FROM targets WHERE source = ? ORDER BY priority ASC LIMIT 1`).get(source) as TargetRow | undefined;
  }

  countTargets(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM targets`).get() as { n: number };
    return row.n;
  }

  nextPriority(): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(priority), 0) + 1 AS p FROM targets`).get() as { p: number };
    return row.p;
  }

  listDecisions(): DecisionRow[] {
    return this.db.prepare(`SELECT * FROM decisions`).all() as DecisionRow[];
  }

  getDecision(targetId: string): DecisionRow | undefined {
    return this.db.prepare(`SELECT * FROM decisions WHERE target_id = ?`).get(targetId) as DecisionRow | undefined;
  }

  upsertDecision(d: DecisionRow): void {
    this.db.prepare(`
      INSERT INTO decisions (target_id, status, checks, decided_at, draft, recipient)
      VALUES (@target_id, @status, @checks, @decided_at, @draft, @recipient)
      ON CONFLICT(target_id) DO UPDATE SET
        status     = excluded.status,
        checks     = excluded.checks,
        decided_at = excluded.decided_at,
        draft      = COALESCE(excluded.draft, decisions.draft),
        recipient  = COALESCE(excluded.recipient, decisions.recipient)
    `).run(d);
  }

  listSources(category?: string): SourceRow[] {
    if (category) {
      return this.db.prepare(`SELECT * FROM sources WHERE enabled = 1 AND category = ?`).all(category) as SourceRow[];
    }
    return this.db.prepare(`SELECT * FROM sources WHERE enabled = 1`).all() as SourceRow[];
  }

  upsertSource(s: SourceRow): void {
    this.db.prepare(`
      INSERT INTO sources (url, path, kind, name, enabled, category)
      VALUES (@url, @path, @kind, @name, @enabled, @category)
      ON CONFLICT(url) DO UPDATE SET
        path = excluded.path,
        kind = excluded.kind,
        name = excluded.name,
        enabled = excluded.enabled,
        category = excluded.category
    `).run(s);
  }

  /** Opportunities (targets) filtered by category, highest score first. */
  listOpportunities(category: string, userId: string): TargetRow[] {
    return this.db.prepare(
      `SELECT * FROM targets WHERE category = ? AND user_id = ? ORDER BY score DESC, priority ASC`,
    ).all(category, userId) as TargetRow[];
  }

  startScan(startedAt: string): number {
    const result = this.db.prepare(`INSERT INTO scan_log (started_at) VALUES (?)`).run(startedAt);
    return Number(result.lastInsertRowid);
  }

  finishScan(id: number, finishedAt: string, added: number, updated: number, seen: unknown, error: string | null): void {
    this.db.prepare(`
      UPDATE scan_log
      SET finished_at = ?, added = ?, updated = ?, seen = ?, error = ?
      WHERE id = ?
    `).run(finishedAt, added, updated, JSON.stringify(seen ?? []), error, id);
  }

  recentScans(limit = 20): ScanLogRow[] {
    return this.db.prepare(`
      SELECT * FROM scan_log ORDER BY id DESC LIMIT ?
    `).all(limit) as ScanLogRow[];
  }

  lastScan(): ScanLogRow | undefined {
    return this.db.prepare(`SELECT * FROM scan_log ORDER BY id DESC LIMIT 1`).get() as ScanLogRow | undefined;
  }

  createFollowUp(targetId: string, dueAt: string, note: string | null): number {
    const result = this.db.prepare(`
      INSERT INTO follow_ups (target_id, due_at, note, created_at)
      VALUES (?, ?, ?, ?)
    `).run(targetId, dueAt, note, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  openFollowUps(): FollowUpRow[] {
    return this.db.prepare(`
      SELECT * FROM follow_ups WHERE resolved = 0 ORDER BY due_at ASC
    `).all() as FollowUpRow[];
  }

  resolveFollowUp(id: number): void {
    this.db.prepare(`UPDATE follow_ups SET resolved = 1 WHERE id = ?`).run(id);
  }

  insertRating(input: { target_id: string; draft: string; rating: number; critique: string | null; writer_mode: string | null; writer_model: string | null }): number {
    const result = this.db.prepare(`
      INSERT INTO email_ratings (target_id, draft, rating, critique, writer_mode, writer_model, created_at)
      VALUES (@target_id, @draft, @rating, @critique, @writer_mode, @writer_model, ?)
    `).run({ ...input }, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  ratingsForTarget(targetId: string): RatingRow[] {
    return this.db.prepare(`
      SELECT * FROM email_ratings WHERE target_id = ? ORDER BY id DESC
    `).all(targetId) as RatingRow[];
  }

  preferenceExamples(limit = 4): { positive: RatingRow[]; negative: RatingRow[] } {
    const positive = this.db.prepare(`
      SELECT * FROM email_ratings WHERE rating >= 4 ORDER BY id DESC LIMIT ?
    `).all(limit) as RatingRow[];
    const negative = this.db.prepare(`
      SELECT * FROM email_ratings WHERE rating <= 2 ORDER BY id DESC LIMIT ?
    `).all(limit) as RatingRow[];
    return { positive, negative };
  }

  logSkillRun(run: { skill: string; target_id: string | null; status: "ok" | "error" | "stub"; input: unknown; output: unknown; error: string | null; duration_ms: number }): void {
    this.db.prepare(`
      INSERT INTO skill_runs (skill, target_id, status, input, output, error, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.skill,
      run.target_id,
      run.status,
      run.input == null ? null : JSON.stringify(run.input),
      run.output == null ? null : JSON.stringify(run.output),
      run.error,
      run.duration_ms,
      new Date().toISOString(),
    );
  }

  recentSkillRuns(skill: string, limit = 5): SkillRunRow[] {
    return this.db.prepare(`
      SELECT * FROM skill_runs WHERE skill = ? ORDER BY id DESC LIMIT ?
    `).all(skill, limit) as SkillRunRow[];
  }

  resequencePriorities(): void {
    const rows = this.listTargets();
    const stmt = this.db.prepare(`UPDATE targets SET priority = ? WHERE id = ?`);
    const tx = this.db.transaction((items: TargetRow[]) => {
      items.forEach((row, index) => stmt.run(index + 1, row.id));
    });
    tx(rows);
  }
}
