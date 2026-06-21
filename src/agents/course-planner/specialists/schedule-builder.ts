/**
 * schedule-builder specialist — assembles a conflict-free schedule from the
 * top candidates using the deterministic buildSchedule tool.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent, AgentContext } from "../../types.ts";
import { buildSchedule, parseDayCodes, type SchedulableSection } from "../../../scorer/scheduleBuilder.ts";
import type { RankedCourse } from "../../../scorer/candidates.ts";

export interface SchedBuildInput { candidates: RankedCourse[]; maxUnits?: number }
export interface SchedBuildOutput {
  chosen: RankedCourse[];
  skipped: Array<{ label: string; reason: string }>;
  totalUnits: number;
  summary: string;
}

export function buildFromCandidates(input: SchedBuildInput): SchedBuildOutput {
  const withTimes = input.candidates.filter(rc => rc.cand.section && rc.cand.section.start_min != null);
  const schedulable: SchedulableSection[] = withTimes.map(rc => ({
    id: rc.cand.section!.id,
    courseId: rc.cand.course.id,
    label: `${rc.cand.course.subject} ${rc.cand.course.number}`,
    units: rc.cand.course.units ?? 3,
    fitScore: rc.fit.score,
    slot: { days: parseDayCodes(rc.cand.section!.days), startMin: rc.cand.section!.start_min, endMin: rc.cand.section!.end_min },
  }));

  const built = buildSchedule(schedulable, input.maxUnits ?? 18);
  const byId = new Map(withTimes.map(rc => [rc.cand.section!.id, rc]));
  const chosen = built.chosen.map(s => byId.get(s.id)!).filter(Boolean);

  return {
    chosen,
    skipped: built.skipped.map(s => ({ label: s.section.label, reason: s.reason })),
    totalUnits: built.totalUnits,
    summary: `Assembled a conflict-free ${built.totalUnits}-unit schedule of ${chosen.length} classes (${built.skipped.length} set aside for conflicts/unit cap).`,
  };
}

export const scheduleBuilderAgent: Agent<SchedBuildInput, SchedBuildOutput> = {
  name: "schedule-builder",
  description: "Assembles a conflict-free, unit-capped weekly schedule from the highest-fit candidate courses.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(buildFromCandidates(input)),
};

registerAgent(scheduleBuilderAgent);
