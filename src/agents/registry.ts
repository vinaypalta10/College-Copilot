import type { Agent, AgentContext, AgentStatus } from "./types.ts";
import { log } from "../lib/log.ts";

const registry = new Map<string, Agent>();

export function registerAgent<I, O>(agent: Agent<I, O>): void {
  if (registry.has(agent.name)) {
    log.warn("agent already registered, overwriting", { agent: agent.name });
  }
  registry.set(agent.name, agent as Agent);
}

export function getAgent(name: string): Agent | undefined {
  return registry.get(name);
}

export function listAgents(): { name: string; description: string; status: AgentStatus; skills: string[]; delegatesTo: string[] }[] {
  return [...registry.values()].map(a => ({
    name: a.name,
    description: a.description,
    status: a.status,
    skills: [...a.skills],
    delegatesTo: [...(a.delegatesTo ?? [])],
  }));
}

export async function runAgent<I = unknown, O = unknown>(name: string, input: I, ctx: AgentContext): Promise<O> {
  const agent = registry.get(name) as Agent<I, O> | undefined;
  if (!agent) throw new Error(`Unknown agent: ${name}`);
  return agent.run(input, ctx);
}
