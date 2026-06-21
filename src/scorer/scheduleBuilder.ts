/**
 * Schedule assembly — pure, deterministic, unit-testable.
 *
 * Detects meeting-time conflicts for manually assembled schedules.
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
