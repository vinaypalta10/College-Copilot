/**
 * Import Berkeley faculty from official public campus and department pages.
 *
 * Usage:
 *   npm run import:professors
 *   npm run import:professors -- --no-details
 *   npm run import:professors -- --max-pages 3 --concurrency 4
 */
import "../lib/loadEnv.ts";
import { closeDb, getDb } from "../db/client.ts";
import { importBerkeleyFaculty } from "../ingest/berkeleyFaculty.ts";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const maxPages = valueAfter("max-pages") ? Number(valueAfter("max-pages")) : undefined;
const concurrency = valueAfter("concurrency") ? Number(valueAfter("concurrency")) : undefined;
const enrichDetails = !process.argv.includes("--no-details");

console.log("Importing official UC Berkeley faculty data...");
console.log(`Detail enrichment: ${enrichDetails ? "on" : "off"}`);

try {
  const summary = await importBerkeleyFaculty(getDb(), {
    maxPages,
    concurrency,
    enrichDetails,
  });
  console.log(`Sources checked: ${summary.sources}`);
  console.log(`Faculty records seen: ${summary.seen}`);
  console.log(`Unique professors saved: ${summary.saved}`);
  if (summary.errors.length) {
    console.warn(`Completed with ${summary.errors.length} warning(s):`);
    for (const error of summary.errors.slice(0, 20)) console.warn(`- ${error}`);
    if (summary.errors.length > 20) console.warn(`- ...and ${summary.errors.length - 20} more`);
  }
} catch (error) {
  console.error(`Professor import failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  closeDb();
}
