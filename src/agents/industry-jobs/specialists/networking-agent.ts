/**
 * networking-agent — surfaces possible networking leads for a coffee chat.
 *
 * SAFETY: this agent never messages anyone, never sends connection requests,
 * and never automates outreach. It only builds search URLs and a draft opener
 * the student can click and use manually (design rule #5).
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { NormalizedJob } from "../types.ts";

export interface NetworkingInput {
  job: NormalizedJob;
  student?: { name?: string; major?: string; school?: string };
}
export interface NetworkingLead {
  label: string;
  searchUrl: string;
  kind: "linkedin" | "company";
}
export interface NetworkingOutput {
  leads: NetworkingLead[];
  /** A short opener the student can adapt — not sent anywhere. */
  draftOpener: string;
  /** Always true: user must click; nothing is automated. */
  userClickOnly: true;
  note: string;
}

function q(s: string): string {
  return encodeURIComponent(s.trim());
}

export function findNetworkingLeads(input: NetworkingInput): NetworkingOutput {
  const j = input.job;
  const school = input.student?.school ?? "UC Berkeley";
  const skill = j.requiredSkills[0] ?? j.preferredSkills[0] ?? "";

  const leads: NetworkingLead[] = [
    { kind: "linkedin", label: `${j.company} alumni from ${school}`, searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${q(`${j.company} ${school}`)}` },
    { kind: "linkedin", label: `${j.title.split(/[|,–—-]/)[0]?.trim()} at ${j.company}`, searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${q(`${j.title} ${j.company}`)}` },
    { kind: "linkedin", label: `Recruiters at ${j.company}`, searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${q(`${j.company} recruiter university`)}` },
    { kind: "company", label: `${j.company} team / people page`, searchUrl: `https://www.google.com/search?q=${q(`${j.company} team OR people OR "meet the team"`)}` },
  ];

  const draftOpener = [
    `Hi [name], I'm ${input.student?.name ?? `a ${school} student`}${input.student?.major ? ` studying ${input.student.major}` : ""}.`,
    `I'm exploring the ${j.title} role at ${j.company}${skill ? ` and have been working with ${skill}` : ""}.`,
    `Would you be open to a quick 15-minute chat about your experience there? Totally understand if you're busy.`,
  ].join(" ");

  return {
    leads,
    draftOpener,
    userClickOnly: true,
    note: "These are search links and a draft only. Open them yourself and send any message manually — College Copilot never contacts anyone for you.",
  };
}

export const networkingAgent: Agent<NetworkingInput, NetworkingOutput> = {
  name: "networking-agent",
  description: "Builds LinkedIn/company search links and a draft opener for coffee chats. User-click driven only — never automates outreach.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(findNetworkingLeads(input)),
};

registerAgent(networkingAgent);
