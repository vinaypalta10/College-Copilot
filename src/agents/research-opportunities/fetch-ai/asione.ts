/**
 * ASI:One answer formatter for the research-opportunities orchestrator.
 *
 * The Fetch.ai uAgent (chat_agent.py) calls our HTTP search endpoint and needs
 * to return a single chat message. Keeping the formatting here (in TS, unit-
 * testable) means the Python bridge stays a thin transport shim.
 *
 * This module performs no I/O and sends nothing — it only shapes text.
 */

import type { ResearchOrchestratorOutput } from "../orchestrator.ts";

/** Render the orchestrator result as a markdown answer for an ASI:One chat. */
export function formatResearchAnswer(out: ResearchOrchestratorOutput): string {
  if (!out.research.length) {
    return `I searched US-wide research sources but didn't find clear undergraduate openings. ${out.summary}`;
  }

  const lines: string[] = [out.summary, ""];
  out.research.slice(0, 8).forEach((o, i) => {
    const bits = [
      `**${i + 1}. ${o.title}** — ${o.organization} (${o.opportunityType})`,
      o.topics.length ? `   topics: ${o.topics.slice(0, 4).join(", ")}` : null,
      o.deadline ? `   deadline: ${o.deadline}` : null,
      o.fit ? `   why: ${o.fit}` : null,
      `   link: ${o.url}`,
    ].filter(Boolean);
    lines.push(...(bits as string[]));
  });

  lines.push("", "_Drafts for outreach are available on request — nothing is sent automatically._");
  return lines.join("\n");
}

/** Compact trace ASI:One can show as "what the agent did". */
export function formatTrace(out: ResearchOrchestratorOutput): string {
  return out.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.agent}: ${s.summary}`).join("\n");
}
