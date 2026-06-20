import { z } from "zod";

export const decisionStatus = z.enum([
  "pending",
  "approved",
  "sent",
  "replied",
  "no_response",
  "follow_up",
]);

export const decisionPatch = z.object({
  status: decisionStatus.optional(),
  checks: z.record(z.string(), z.boolean()).optional(),
  draft: z.string().max(10_000).optional(),
  recipient: z.string().max(254).optional(),
});

export const decisionsBulk = z.object({
  decisions: z.record(z.string(), z.object({
    decision: decisionStatus.optional(),
    checks: z.record(z.string(), z.boolean()).optional(),
    decidedAt: z.string().optional(),
  })),
});

export const writeEmailRequest = z.object({
  targetId: z.string().min(1).max(64),
  currentDraft: z.string().max(10_000).optional(),
});

export const followUpRequest = z.object({
  targetId: z.string().min(1).max(64),
  dueAt: z.string().datetime(),
  note: z.string().max(500).optional(),
});

export type DecisionPatch = z.infer<typeof decisionPatch>;
export type DecisionsBulk = z.infer<typeof decisionsBulk>;
export type WriteEmailRequest = z.infer<typeof writeEmailRequest>;
export type FollowUpRequest = z.infer<typeof followUpRequest>;
