export interface ProfileFacet {
  id: string;
  label: string;
  description: string;
  keywords: string[];
}

export interface Profile {
  name: string;
  school: string;
  major: string;
  facets: ProfileFacet[];
  proof: string[];
  styleNotes: string[];
}

export const profile: Profile = {
  name: "Ruoxi Wu",
  school: "UC Berkeley",
  major: "Data Science",
  facets: [
    {
      id: "agent-eval",
      label: "Agent evaluation and benchmarks",
      description: "Designing benchmarks and trace-level evaluation for LLM agents on realistic workflow artifacts.",
      keywords: ["agent", "agents", "evaluation", "eval", "benchmark", "benchmarks", "trajectory", "trace"],
    },
    {
      id: "tool-use",
      label: "Tool use and function calling",
      description: "Reliability of tool/function calling, API correctness, runtime safety.",
      keywords: ["tool", "function calling", "function-calling", "api", "runtime", "reliability"],
    },
    {
      id: "memory-retrieval",
      label: "Memory and retrieval",
      description: "Retrieval over alerts, postmortems, code diffs; long-context memory for agents.",
      keywords: ["memory", "retrieval", "rag", "context", "postmortem", "alert", "recall"],
    },
    {
      id: "workflow-automation",
      label: "Workflow automation",
      description: "Agent workflows in finance, ops, and other applied domains.",
      keywords: ["workflow", "automation", "operations", "finance", "diligence", "ops"],
    },
    {
      id: "systems-infra",
      label: "ML systems and infra",
      description: "Inference serving, reproducible experiment runners, evaluation infrastructure.",
      keywords: ["systems", "inference", "serving", "infrastructure", "infra", "reproducible", "pytorch"],
    },
    {
      id: "verifiable-reasoning",
      label: "Verifiable reasoning",
      description: "Lean 4 and multi-agent proof-system work around grounded, checkable reasoning.",
      keywords: ["lean", "proof", "verifiable", "formal", "verification"],
    },
  ],
  proof: [
    "BAIR AgentHLE benchmark for LLM agents in private-equity workflows (factual grounding, numerical consistency, hallucination risk, usefulness).",
    "Postmortem Memory Agent retrieving over alerts, postmortems, code diffs, and recurring failures (2nd place, Build SMTH AI Hackathon; +30% retrieval accuracy in demo eval).",
    "GeneLLM reproducible PyTorch experiment runner for comparable model variants.",
    "Lean 4 and multi-agent proof-system work around verifiable reasoning.",
  ],
  styleNotes: [
    "Write like a real student: concise, warm, specific, low-pressure, not over-polished.",
    "Use the relationship-first method: introduce briefly, show genuine interest, ask ONE thoughtful question about the recipient's project, invite a 20–30 minute chat.",
    "Do not pitch a research position directly. Do not attach or mention a resume. Do not list experience bullets.",
    "Subtly reference agent-evaluation background only when it grounds the question.",
    "Avoid hype, flattery, generic AI interest, and phrases like 'I am passionate about'.",
  ],
};

export function profileKeywords(): string[] {
  return Array.from(new Set(profile.facets.flatMap(f => f.keywords)));
}
