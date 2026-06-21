import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { RankedCourse } from "../../scorer/candidates.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";
import { courseMatchesRequirement } from "../../scorer/requirements.ts";
import type { QueryConstraints } from "./student-query-agent.ts";

export type CourseLevelPolicy = "undergraduate" | "graduate" | "any";

export interface SchoolPolicyInput {
  prefs: StudentPrefs;
  constraints: QueryConstraints;
  baseMajor: string | null;
  query: string;
}

export interface SchoolPolicyOutput {
  requirements: string[];
  level: CourseLevelPolicy;
  warnings: string[];
  answer: string;
  summary: string;
}

export interface RequirementCoverage {
  coverage: Array<{ requirement: string; courses: string[] }>;
  uncovered: string[];
}

export function checkRequirements(candidates: RankedCourse[], requirements: string[]): RequirementCoverage {
  const coverage: RequirementCoverage["coverage"] = [];
  const uncovered: string[] = [];
  for (const requirement of requirements) {
    const courses = candidates
      .filter(({ cand }) => courseMatchesRequirement(cand.course, requirement))
      .slice(0, 5)
      .map(({ cand }) => `${cand.course.subject} ${cand.course.number}`);
    if (courses.length) coverage.push({ requirement, courses });
    else uncovered.push(requirement);
  }
  return { coverage, uncovered };
}

function policyAnswer(input: SchoolPolicyInput, ctx?: AgentContext): string {
  const text = input.query.toLowerCase();
  if (/\b(prerequisite|prereq|can i take|may i take)\b/.test(text) && input.constraints.subject && ctx) {
    const number = [...input.query.matchAll(/\b([A-Z]?\d{1,3}[A-Z]?)\b/gi)]
      .map(match => match[1]!.toUpperCase())
      .find(value => Number(value.match(/\d+/)?.[0]) <= 399);
    const course = number ? ctx.repo.listCourses().find(item => item.subject === input.constraints.subject && item.number.toUpperCase() === number) : undefined;
    if (course) return course.prerequisites
      ? `${course.subject} ${course.number} lists these prerequisites: ${course.prerequisites}`
      : `${course.subject} ${course.number} has no prerequisite text in the current catalog data.`;
  }
  if (/\b(remaining requirements?|degree requirements?|what.*requirements?)\b/.test(text)) {
    return input.prefs.requirementsRemaining?.length
      ? `Your saved remaining requirements are: ${input.prefs.requirementsRemaining.join(", ")}.`
      : "Your profile does not currently list any remaining requirements.";
  }
  if (/\b(upper division|lower division|graduate course)\b/.test(text)) {
    return "For this planner, Berkeley course numbers below 100 are treated as lower division, 100-199 as undergraduate upper division, and 200+ as graduate level.";
  }
  if (/\b(transfer|switch|change|declare|eligib)\b/.test(text)) {
    return "The planner can compare courses for a target major, but it cannot determine declaration, transfer, or admission eligibility from the available data.";
  }
  return input.prefs.requirementsRemaining?.length
    ? `I can interpret your saved requirements (${input.prefs.requirementsRemaining.join(", ")}) and catalog prerequisites, but official policy should be confirmed with Berkeley advising.`
    : "I can explain catalog prerequisites and course-level conventions, but your profile has no saved requirements and official policy should be confirmed with Berkeley advising.";
}

export function reviewSchoolPolicy(input: SchoolPolicyInput, ctx?: AgentContext): SchoolPolicyOutput {
  const requirements = [...new Set((input.prefs.requirementsRemaining ?? []).map(item => item.trim()).filter(Boolean))];
  const level = input.constraints.level
    ?? (input.constraints.minCourseNumber != null && input.constraints.minCourseNumber >= 200 ? "graduate" : "undergraduate");
  const warnings: string[] = [];

  if (input.constraints.targetMajor && input.constraints.targetMajor !== input.baseMajor) {
    warnings.push(`Planning for ${input.constraints.targetMajor} does not verify change-of-major eligibility or admission.`);
  }
  if (level === "graduate") {
    warnings.push("Graduate courses may require instructor approval or prerequisites not represented in the catalog ranking.");
  }
  if (requirements.length) {
    warnings.push("Requirement matches use catalog text and are not an official Berkeley degree audit.");
  } else {
    warnings.push("No remaining requirements are saved, so requirement coverage cannot be evaluated.");
  }

  return {
    requirements,
    level,
    warnings,
    answer: policyAnswer(input, ctx),
    summary: `Applied ${level} course policy with ${requirements.length} stated remaining requirement(s). ${warnings.join(" ")}`,
  };
}

export const schoolPolicyAgent: Agent<SchoolPolicyInput, SchoolPolicyOutput> = {
  name: "school-policy-agent",
  description: "Interprets course-level and stated requirement policy conservatively, with explicit degree-audit and eligibility caveats.",
  status: "active",
  skills: [],
  run: (input, ctx) => Promise.resolve(reviewSchoolPolicy(input, ctx)),
};

registerAgent(schoolPolicyAgent);
