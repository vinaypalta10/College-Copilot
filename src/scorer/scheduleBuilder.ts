/**
 * Schedule assembly — pure, deterministic, unit-testable.
 *
 * Detects meeting-time conflicts and greedily assembles a conflict-free
 * schedule from fit-ranked candidates, honoring a unit cap. No DB, no network.
 */

export interface MeetingSlot {
  /** Day codes like ["M","W","F"] or ["Tu","Th"]. */
  days: string[];
  startMin: number | null;
  endMin: number | null;
}

export interface SchedulableSection {
  id: string;
  courseId: string;
  label: string;
  units: number;
  slot: MeetingSlot;
  fitScore: number;
}

export function parseDayCodes(code: string | null | undefined): string[] {
  if (!code) return [];
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (["Tu", "Th", "Sa", "Su"].includes(two)) { out.push(two); i += 2; }
    else { out.push(code[i]!); i += 1; }
  }
  return out;
}

/** Two slots conflict if they share a day and their time ranges overlap. */
export function slotsConflict(a: MeetingSlot, b: MeetingSlot): boolean {
  if (a.startMin == null || a.endMin == null || b.startMin == null || b.endMin == null) return false;
  const shareDay = a.days.some(d => b.days.includes(d));
  if (!shareDay) return false;
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export interface BuildResult {
  chosen: SchedulableSection[];
  skipped: Array<{ section: SchedulableSection; reason: string }>;
  totalUnits: number;
}

/**
 * Greedy: consider sections by descending fit, add each unless it conflicts
 * with an already-chosen section or would exceed maxUnits. One section per course.
 */
export function buildSchedule(sections: SchedulableSection[], maxUnits = 18, maxCourses = Number.POSITIVE_INFINITY): BuildResult {
  const ordered = [...sections].sort((a, b) => b.fitScore - a.fitScore);
  const chosen: SchedulableSection[] = [];
  const skipped: BuildResult["skipped"] = [];
  let totalUnits = 0;
  const usedCourses = new Set<string>();

  for (const s of ordered) {
    if (chosen.length >= maxCourses) { skipped.push({ section: s, reason: `would exceed ${maxCourses}-course cap` }); continue; }
    if (usedCourses.has(s.courseId)) { skipped.push({ section: s, reason: "another section of this course is already chosen" }); continue; }
    const conflict = chosen.find(c => slotsConflict(c.slot, s.slot));
    if (conflict) { skipped.push({ section: s, reason: `conflicts with ${conflict.label}` }); continue; }
    if (totalUnits + s.units > maxUnits) { skipped.push({ section: s, reason: `would exceed ${maxUnits}-unit cap` }); continue; }
    chosen.push(s);
    usedCourses.add(s.courseId);
    totalUnits += s.units;
  }

  return { chosen, skipped, totalUnits };
}

/** All conflicting pairs in a fixed set (for highlighting an existing schedule). */
export function findConflicts(sections: SchedulableSection[]): Array<[SchedulableSection, SchedulableSection]> {
  const pairs: Array<[SchedulableSection, SchedulableSection]> = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      if (slotsConflict(sections[i]!.slot, sections[j]!.slot)) pairs.push([sections[i]!, sections[j]!]);
    }
  }
  return pairs;
}
