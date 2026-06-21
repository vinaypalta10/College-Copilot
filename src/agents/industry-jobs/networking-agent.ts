/**
 * networking-agent — prepares coffee-chat leads for a posting.
 *
 * SAFETY RULE (see README): this agent NEVER messages anyone. It only builds
 * LinkedIn / company search URLs the student clicks themselves, plus optional
 * draft text they may copy. No connection request, message, or email is ever
 * sent automatically.
 */

import { registerAgent } from "../registry.ts";
import type { Agent, AgentContext } from "../types.ts";
import type { StudentPrefs } from "../../scorer/courseScore.ts";
import type { NetworkingLead, NetworkingResult, NormalizedJob } from "./types.ts";

function linkedInPeopleSearch(keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

function linkedInCompany(company: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`;
}

export interface NetworkingInput {
  job: Pick<NormalizedJob, "title" | "company" | "requiredSkills"> & { id: string };
  prefs?: StudentPrefs;
  /** The student's own name/school, used only to draft text the user may copy. */
  student?: { name?: string; school?: string };
}

export function buildNetworkingLeads(input: NetworkingInput): NetworkingResult {
  const { job, prefs } = input;
  const company = job.company || "the company";
  const focus = job.requiredSkills[0] || prefs?.interests?.[0] || "";

  const leads: NetworkingLead[] = [
    {
      type: "recruiter",
      label: `Recruiters at ${company}`,
      searchUrl: linkedInPeopleSearch(`${company} recruiter university`),
    },
    {
      type: "team",
      label: `${company} engineers${focus ? ` working on ${focus}` : ""}`,
      searchUrl: linkedInPeopleSearch(`${company} ${focus || job.title}`.trim()),
    },
    {
      type: "alumni",
      label: `${input.student?.school || "Your school"} alumni at ${company}`,
      searchUrl: linkedInPeopleSearch(`${company} ${input.student?.school || ""}`.trim()),
    },
    {
      type: "company",
      label: `${company} on LinkedIn`,
      searchUrl: linkedInCompany(company),
    },
  ];

  const me = input.student?.name || "a student";
  const school = input.student?.school ? ` at ${input.student.school}` : "";
  const connectionNote = `Hi — I'm ${me}${school}. I saw ${company} is hiring for ${job.title} and I'm really interested in ${focus || "the team's work"}. Would love to connect and learn from your experience.`;
  const coffeeChatMessage = [
    `Hi [name],`,
    "",
    `I'm ${me}${school}, exploring ${focus || job.title} roles. I came across the ${job.title} opening at ${company} and your background stood out.`,
    `Would you be open to a 15-minute virtual coffee chat in the next couple of weeks? I'd love to hear how you got into the team and any advice for applicants. No worries at all if you're busy.`,
    "",
    `Thanks so much,`,
    me,
  ].join("\n");

  return {
    job: { id: job.id, title: job.title, company },
    leads,
    connectionNote,
    coffeeChatMessage,
    safetyNote: "These are search links and draft text only. Nothing is sent — review each lead and click manually.",
  };
}

export const networkingAgent: Agent<NetworkingInput, NetworkingResult> = {
  name: "networking-agent",
  description: "Prepares LinkedIn/company search leads and optional draft outreach for a job. Never messages, connects, or emails anyone automatically — the student must click.",
  status: "active",
  skills: ["networking-search"],
  run: async (input: NetworkingInput, _ctx: AgentContext) => buildNetworkingLeads(input),
};

registerAgent(networkingAgent);
