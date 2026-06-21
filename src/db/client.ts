import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "schema.sql");

export type DB = Database.Database;

let instance: DB | null = null;

export function getDb(path?: string): DB {
  if (instance) return instance;
  const dbPath = path
    ?? process.env.COLLEGE_COPILOT_DB_PATH
    ?? process.env.OUTREACH_DB_PATH
    ?? join(process.cwd(), "data", "outreach.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
  runMigrations(db);
  instance = db;
  return db;
}

/** Idempotent column additions for tables that predate the College Copilot pivot. */
function runMigrations(db: DB): void {
  ensureColumn(db, "targets", "user_id", "TEXT");
  ensureColumn(db, "targets", "category", "TEXT DEFAULT 'research'");
  ensureColumn(db, "sources", "category", "TEXT DEFAULT 'research'");
  ensureColumn(db, "courses", "prerequisites", "TEXT");
  ensureColumn(db, "courses", "avg_gpa", "REAL");
  ensureColumn(db, "student_profiles", "college", "TEXT");

  // Backfill category for pre-existing rows from the latent path/kind signal.
  db.exec(`UPDATE targets SET category = 'industry'
           WHERE category IS NULL AND (path = 'B' OR lab LIKE '%Startup%' OR lab LIKE '%company%')`);
  db.exec(`UPDATE targets SET category = 'research' WHERE category IS NULL`);
}

function ensureColumn(db: DB, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
