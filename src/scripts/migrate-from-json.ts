import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../db/client.ts";
import { Repo, type TargetRow, type SourceRow } from "../db/repo.ts";

interface LegacyTarget {
  id?: string;
  p?: number;
  path?: string;
  name?: string;
  lab?: string;
  project?: string;
  fit?: string;
  contact?: string;
  sentence?: string;
  source?: string;
  notes?: string;
  status?: string;
  extractedAt?: string;
  lastSeenAt?: string | null;
  score?: number;
  evidence?: string;
}

interface LegacyDb {
  targets?: LegacyTarget[];
  decisions?: Record<string, { decision?: string; checks?: Record<string, boolean>; decidedAt?: string }>;
  scanLog?: unknown[];
}

interface LegacySource {
  path: string;
  kind: string;
  name: string;
  url: string;
}

function toTargetRow(t: LegacyTarget, index: number): TargetRow {
  const isAuto = String(t.notes ?? "").startsWith("Auto-extracted") ? 1 : 0;
  return {
    id: t.id ?? `t_legacy_${index}`,
    priority: Number(t.p ?? index + 1),
    path: t.path ?? "A",
    name: t.name ?? "Unknown",
    lab: t.lab ?? null,
    project: t.project ?? null,
    fit: t.fit ?? null,
    contact: t.contact ?? null,
    sentence: t.sentence ?? null,
    source: t.source ?? null,
    notes: t.notes ?? null,
    evidence: t.evidence ?? null,
    score: Number(t.score ?? 0),
    score_facets: null,
    extracted_at: t.extractedAt ?? new Date().toISOString(),
    last_seen_at: t.lastSeenAt ?? null,
    auto: isAuto,
  };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const targetsJsonPath = join(root, "data", "targets.json");
  const sourcesJsonPath = join(root, "data", "sources.json");

  const db = getDb();
  const repo = new Repo(db);

  let importedTargets = 0;
  let importedDecisions = 0;
  let importedSources = 0;

  try {
    const raw = await readFile(targetsJsonPath, "utf8");
    const data = JSON.parse(raw) as LegacyDb;
    const targets = data.targets ?? [];
    const tx = db.transaction((rows: LegacyTarget[]) => {
      rows.forEach((t, i) => {
        const row = toTargetRow(t, i);
        repo.upsertTarget(row);
        importedTargets++;
      });
    });
    tx(targets);

    const decisions = data.decisions ?? {};
    for (const [key, value] of Object.entries(decisions)) {
      const target = targets.find(t => String(t.p) === String(key) || t.id === key);
      if (!target?.id) continue;
      repo.upsertDecision({
        target_id: target.id,
        status: value.decision ?? "pending",
        checks: value.checks ? JSON.stringify(value.checks) : null,
        decided_at: value.decidedAt ?? null,
        draft: null,
        recipient: null,
      });
      importedDecisions++;
    }
  } catch (error) {
    console.warn(`Skipping targets.json import: ${(error as Error).message}`);
  }

  try {
    const raw = await readFile(sourcesJsonPath, "utf8");
    const sources = JSON.parse(raw) as LegacySource[];
    for (const s of sources) {
      repo.upsertSource({
        url: s.url,
        path: s.path,
        kind: s.kind,
        name: s.name,
        enabled: 1,
      });
      importedSources++;
    }
  } catch (error) {
    console.warn(`Skipping sources.json import: ${(error as Error).message}`);
  }

  console.log(`Migration complete: ${importedTargets} targets, ${importedDecisions} decisions, ${importedSources} sources`);
}

main().catch(error => {
  console.error("Migration failed:", error);
  process.exit(1);
});
