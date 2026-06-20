import type { TargetRow } from "../db/repo.ts";

export function inferPaperQuestion(target: Pick<TargetRow, "project" | "evidence" | "sentence">): string {
  const project = target.project || "your work";
  const lower = `${target.project ?? ""} ${target.evidence ?? ""} ${target.sentence ?? ""}`.toLowerCase();
  if (lower.includes("mast") || lower.includes("failure taxonomy")) {
    return "I was wondering how you decided which failure modes should be separate categories rather than grouped under a broader agent-planning or coordination failure.";
  }
  if (lower.includes("search arena")) {
    return "I was curious how you separate failures caused by retrieval quality from failures caused by how the model uses retrieved evidence.";
  }
  if (lower.includes("bfcl") || lower.includes("function") || lower.includes("tool")) {
    return "I was curious how you chose the boundary between an invalid tool call and a tool call that is syntactically valid but not useful for the task.";
  }
  if (lower.includes("agent") || lower.includes("benchmark")) {
    return "I was curious how you decide whether a benchmark item is measuring the agent's reasoning ability versus the surrounding system design.";
  }
  return `I was curious about one design choice in ${project}: how you decided what to evaluate directly versus what to leave as qualitative failure analysis.`;
}

export function localDraft(target: TargetRow): string {
  const firstName = (target.name || "there").split(/\s+/)[0];
  const project = target.project || "your recent work";
  const question = inferPaperQuestion(target);
  const topic = target.path === "A" ? "agent evaluation and reliability" : "reliable agent workflows";
  return `Subject: Question about ${project}

Hi ${firstName},

I'm Ruoxi Wu, a UC Berkeley Data Science undergrad. I've been trying to understand ${topic} better, and in doing so came across your work on ${project}.

${question}

I'm asking because I have been working on evaluation setups for LLM agents, and this part of your methodology seems closely related to the question of how to make agent failures concrete enough to study rather than just describe after the fact.

Would you be open to a 20–30 minute chat sometime next week? I'd be happy to meet over Zoom or come by in person if that is easier.

Best,
Ruoxi`;
}
