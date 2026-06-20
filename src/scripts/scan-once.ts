import { getDb } from "../db/client.ts";
import { Repo } from "../db/repo.ts";
import { runScan } from "../scanner/runner.ts";

async function main(): Promise<void> {
  const repo = new Repo(getDb());
  const result = await runScan(repo);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error("Scan failed:", error);
  process.exit(1);
});
