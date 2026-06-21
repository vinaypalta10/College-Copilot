/**
 * Remove opportunity rows from the local SQLite database while preserving
 * College Copilot data: courses, sections, instructors, users, profiles, and
 * saved plans. Opportunities are now found dynamically by the agent pipeline.
 */
import { getDb } from "../db/client.ts";

async function main(): Promise<void> {
  const db = getDb();

  const tx = db.transaction(() => {
    const deletedDecisions = db.prepare("DELETE FROM decisions WHERE target_id IN (SELECT id FROM targets)").run().changes;
    const deletedRatings = db.prepare("DELETE FROM email_ratings WHERE target_id IN (SELECT id FROM targets)").run().changes;
    const deletedFollowUps = db.prepare("DELETE FROM follow_ups WHERE target_id IN (SELECT id FROM targets)").run().changes;
    const deletedTargets = db.prepare("DELETE FROM targets").run().changes;
    const deletedSources = db.prepare("DELETE FROM sources").run().changes;
    const deletedScans = db.prepare("DELETE FROM scan_log").run().changes;

    return { deletedTargets, deletedSources, deletedScans, deletedDecisions, deletedRatings, deletedFollowUps };
  });

  const result = tx();
  const counts = {
    courses: (db.prepare("SELECT COUNT(*) AS n FROM courses").get() as { n: number }).n,
    sections: (db.prepare("SELECT COUNT(*) AS n FROM sections").get() as { n: number }).n,
    instructors: (db.prepare("SELECT COUNT(*) AS n FROM instructors").get() as { n: number }).n,
    cachedOpportunities: (db.prepare("SELECT COUNT(*) AS n FROM targets").get() as { n: number }).n,
    cachedSources: (db.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number }).n,
  };

  console.log(`Deleted ${result.deletedTargets} opportunities, ${result.deletedSources} sources, ${result.deletedScans} scan logs.`);
  console.log(`Deleted dependent rows: ${result.deletedDecisions} decisions, ${result.deletedRatings} ratings, ${result.deletedFollowUps} follow-ups.`);
  console.log(`Kept ${counts.courses} courses, ${counts.sections} sections, ${counts.instructors} instructors, ${counts.cachedOpportunities} cached opportunities, ${counts.cachedSources} cached sources.`);
}

main().catch((err) => {
  console.error("Clean legacy data failed:", err);
  process.exit(1);
});
