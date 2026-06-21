import type { CourseRow } from "../db/repo.ts";

function norm(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function courseLevel(course: CourseRow): "lower" | "upper" | "graduate" | "unknown" {
  const match = course.number.match(/\d+/);
  if (!match) return "unknown";
  const number = Number(match[0]);
  if (number >= 200) return "graduate";
  if (number >= 100) return "upper";
  return "lower";
}

export function courseMatchesRequirement(course: CourseRow, requirement: string): boolean {
  const req = norm(requirement);
  if (!req) return false;
  const level = courseLevel(course);
  if (/\bUPPER\s+DIV(?:ISION)?\b/.test(req)) return level === "upper";
  if (/\bLOWER\s+DIV(?:ISION)?\b/.test(req)) return level === "lower";

  const label = norm(`${course.subject} ${course.number}`);
  if (req === label) return true;
  const satisfied = norm(course.requirements_satisfied ?? "");
  if (satisfied.includes(req)) return true;

  const hay = norm(`${label} ${course.title} ${course.description ?? ""}`);
  const tokens = req.split(" ").filter(token => token.length > 2);
  return tokens.length > 0 && tokens.every(token => hay.includes(token));
}
