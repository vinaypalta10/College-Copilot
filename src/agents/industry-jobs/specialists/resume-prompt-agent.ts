/**
 * resume-prompt-agent — builds a ready-to-paste prompt the student can use with
 * Claude or ChatGPT together with their own resume.
 *
 * It does NOT see or store the resume. It assembles the digested job into a
 * tailoring prompt so the student keeps their resume private and runs the
 * tailoring themselves. Pure string assembly, no network.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { NormalizedJob } from "../types.ts";

export interface ResumePromptInput {
  job: NormalizedJob;
  student?: { major?: string; gradYear?: string };
}
export interface ResumePromptOutput {
  prompt: string;
  /** Reminder for the UI: the student supplies their own resume; we never store it. */
  note: string;
}

function bullets(label: string, items: string[]): string {
  if (!items.length) return "";
  return `${label}:\n${items.map((i) => `- ${i}`).join("\n")}`;
}

export function buildResumePrompt(input: ResumePromptInput): ResumePromptOutput {
  const j = input.job;
  const skills = [...j.requiredSkills, ...j.preferredSkills];
  const context = [input.student?.major ? `I'm a ${input.student.major} student` : null, input.student?.gradYear ? `graduating ${input.student.gradYear}` : null]
    .filter(Boolean).join(", ");

  const prompt = [
    `You are a resume coach. I'm applying to the role below. Help me tailor MY resume (pasted at the end) to it.`,
    context ? context + "." : null,
    "",
    `ROLE: ${j.title} at ${j.company} (${j.employmentType.replace("_", " ")}, ${j.location})`,
    `POSTING: ${j.url}`,
    bullets("REQUIRED SKILLS", j.requiredSkills),
    bullets("PREFERRED SKILLS", j.preferredSkills),
    bullets("RESPONSIBILITIES", j.responsibilities),
    bullets("QUALIFICATIONS", j.qualifications),
    "",
    "Do the following:",
    "1. List which of my experiences best match the required skills, and which gaps to address.",
    skills.length ? `2. Rewrite 3-5 of my resume bullets to surface ${skills.slice(0, 5).join(", ")} with measurable impact.` : "2. Rewrite 3-5 of my resume bullets to better match the role with measurable impact.",
    "3. Suggest keywords I should add for ATS matching.",
    "4. Flag anything I claim that the posting does NOT support, so I stay honest.",
    "",
    "MY RESUME:",
    "<paste your resume here>",
  ].filter((l) => l !== "").join("\n");

  return {
    prompt,
    note: "Copy this into Claude or ChatGPT and paste your resume where indicated. Your resume is never sent to or stored by College Copilot.",
  };
}

export const resumePromptAgent: Agent<ResumePromptInput, ResumePromptOutput> = {
  name: "resume-prompt-agent",
  description: "Builds a ready-to-paste resume-tailoring prompt for a specific job that the student runs with Claude/ChatGPT and their own resume.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(buildResumePrompt(input)),
};

registerAgent(resumePromptAgent);
