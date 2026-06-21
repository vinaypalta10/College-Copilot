/**
 * outreach-helper — drafts optional outreach text for the user to review.
 *
 * SAFETY: this agent never sends anything. It returns a draft (subject + body +
 * suggested recipient) that the user must read, edit, and send themselves. The
 * design rules forbid automated external side effects.
 */

import { registerAgent } from "../../registry.ts";
import type { Agent } from "../../types.ts";
import type { ResearchOpportunity } from "../types.ts";

export interface OutreachHelperInput {
  opportunity: ResearchOpportunity;
  student: { name?: string; major?: string; interests?: string[] };
}
export interface OutreachDraft {
  subject: string;
  body: string;
  recipient: string | null;
  channel: "email" | "form";
  /** Always true — a reminder for the UI that this is a draft, not a sent message. */
  draftOnly: true;
  note: string;
}

function firstName(name: string): string {
  const cleaned = name.replace(/[|–—-].*$/, "").replace(/\b(lab|group|center|program|university|prof\.?|dr\.?)\b/gi, "").trim();
  const first = cleaned.split(/\s+/)[0];
  return first && /^[A-Z][a-z]+$/.test(first) ? first : "there";
}

export function draftOutreach(input: OutreachHelperInput): OutreachDraft {
  const { opportunity: o, student } = input;
  const me = student.name || "a UC Berkeley student";
  const interests = (student.interests ?? []).slice(0, 3);
  const recipient = o.contact?.includes("@") ? o.contact : null;

  const subject = `Undergraduate interested in ${o.topics[0] ?? "research"} with ${o.organization}`;
  const body = [
    `Hi ${firstName(o.title)},`,
    "",
    `I'm ${me}${student.major ? `, studying ${student.major}` : ""}. I came across ${o.title} (${o.organization}) while looking for undergraduate research${interests.length ? ` in ${interests.join(", ")}` : ""}.`,
    o.topics.length ? `The focus on ${o.topics.slice(0, 2).join(" and ")} is exactly what I'd like to contribute to.` : null,
    "Would there be a way for an undergraduate to get involved, contribute, or apply? I'm happy to share my background and availability.",
    "",
    "Thank you for your time,",
    me,
  ].filter(Boolean).join("\n");

  return {
    subject,
    body,
    recipient,
    channel: recipient ? "email" : "form",
    draftOnly: true,
    note: recipient
      ? "Draft only — review and send it yourself; nothing was sent."
      : "No contact email was found on the page. Open the source link and use its application form; nothing was sent.",
  };
}

export const outreachHelper: Agent<OutreachHelperInput, OutreachDraft> = {
  name: "outreach-helper",
  description: "Drafts optional outreach text for a research opportunity for the user to review and send manually. Never sends anything.",
  status: "active",
  skills: [],
  run: (input) => Promise.resolve(draftOutreach(input)),
};

registerAgent(outreachHelper);
