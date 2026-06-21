/**
 * workload-estimator specialist — holistic balance of a chosen schedule.
 *
 * The per-course scorer estimates each course's load; this agent assesses the
 * whole set (total units + how many heavy courses stack up) and flags an
 * over-loaded semester the per-course view can't see.
 */

import { registerAgent } from "../registry.ts";
import type { Agent } from "../types.ts";
import { estimateWorkload } from "../../scorer/courseScore.ts";
import type { RankedCourse } from "../../scorer/candidates.ts";

export interface WorkloadInput { schedule: RankedCourse[] }
export interface WorkloadOutput {
  totalUnits: number;
  heavyCount: number;
  balance: "light" | "balanced" | "heavy";
  summary: string;
}

export function estimateScheduleWorkload(input: WorkloadInput): WorkloadOutput {
  const totalUnits = input.schedule.reduce((sum, rc) => sum + (rc.cand.course.units ?? 3), 0);
  const heavyCount = input.schedule.filter(rc => estimateWorkload(rc.cand).estimate === "heavy").length;

  let balance: WorkloadOutput["balance"] = "balanced";
  if (totalUnits >= 17 || heavyCount >= 3) balance = "heavy";
  else if (totalUnits <= 12 && heavyCount === 0) balance = "light";

  const note = balance === "heavy"
    ? (heavyCount >= 3
        ? "Several heavy courses stack up — consider swapping one for a lighter option."
        : "High unit load — make sure you can keep up across all of these.")
    : balance === "light"
      ? "You have room to add another course if you want."
      : "This looks like a well-balanced semester.";
  return { totalUnits, heavyCount, balance, summary: `${totalUnits} units, ${heavyCount} heavy course(s). ${note}` };
}

export const workloadEstimator: Agent<WorkloadInput, WorkloadOutput> = {
  name: "workload-estimator",
  description: "Assesses the overall workload balance of a proposed schedule (total units + heavy-course stacking).",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(estimateScheduleWorkload(input)),
};

registerAgent(workloadEstimator);
