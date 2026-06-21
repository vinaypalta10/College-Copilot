/**
 * resume-prompt-agent — builds a copy-paste prompt for the student.
 *
 * The output is NOT sent anywhere. It is a ready-to-paste prompt the student
 * drops into Claude/ChatGPT alongside their own resume, so the model tailors the
 * resume to a specific posting. Deterministic and offline by design — the value
 * is a well-structured prompt grounded in the digested job, not another LLM call.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";
import type { NormalizedJob } from "./types.ts";

const EMPLOYMENT_LABEL: Record<NormalizedJob["employmentType"], string> = {
  internship: "internship",
  new_grad: "new-grad role",
  part_time: "part-time role",
  full_time: "full-time role",
};

function bulletList(items: string[], fallback: string): string {
  if (!items.length) return `- ${fallback}`;
  return items.map((i) => `- ${i}`).join("\n");
}

export interface ResumePromptInput {
  job: NormalizedJob;
  prefs?: StudentPrefs;
}

export function buildResumePrompt(input: ResumePromptInput): string {
  const { job, prefs } = input;
  const label = EMPLOYMENT_LABEL[job.employmentType];
  const studentContext: string[] = [];
  if (prefs?.major) studentContext.push(`I am studying ${prefs.major}.`);
  if (prefs?.interests?.length) studentContext.push(`My interests: ${prefs.interests.slice(0, 5).join(", ")}.`);

  return [
    `You are an expert resume coach. Tailor MY resume (pasted at the end) to the following ${label} so it passes ATS keyword screening and reads as a strong match. Be specific and honest — never invent experience I do not have.`,
    "",
    `# Target role`,
    `- Title: ${job.title}`,
    `- Company: ${job.company}`,
    `- Location: ${job.location}`,
    `- Type: ${label}`,
    `- Link: ${job.url}`,
    "",
    `# Required skills`,
    bulletList(job.requiredSkills, "Not explicitly listed — infer from the responsibilities below."),
    "",
    `# Preferred / nice-to-have`,
    bulletList(job.preferredSkills, "None listed."),
    "",
    `# Responsibilities`,
    bulletList(job.responsibilities, "Not listed — focus on the skills and qualifications."),
    "",
    `# Qualifications`,
    bulletList(job.qualifications, "Not listed."),
    "",
    ...(studentContext.length ? [`# About me`, ...studentContext, ""] : []),
    `# What to do`,
    `1. List which required/preferred skills my resume already evidences, and which are missing.`,
    `2. Rewrite my most relevant 3-5 bullet points to mirror the role's language and required skills, keeping them truthful and quantified.`,
    `3. Suggest a 2-3 sentence summary statement targeted at this role.`,
    `4. Recommend keywords to add for ATS, and flag anything I should NOT claim.`,
    "",
    `# My resume`,
    `<paste your resume here>`,
  ].join("\n");
}

export const resumePromptAgent: Agent<ResumePromptInput, { prompt: string }> = {
  name: "resume-prompt-agent",
  description: "Builds a ready-to-paste resume-tailoring prompt for a specific job; the student runs it with their own resume in Claude/ChatGPT. Sends nothing.",
  status: "active",
  skills: ["resume-prompt"],
  run: async (input: ResumePromptInput, _ctx: AgentContext) => ({ prompt: buildResumePrompt(input) }),
};

registerAgent(resumePromptAgent);
