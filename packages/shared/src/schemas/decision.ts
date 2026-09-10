import { z } from 'zod';

export const DECISION_STATUSES = ['OPEN', 'DECIDED'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const CreateDecisionSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(200),
  detail: z.string().max(4000).default(''),
  /** Set when a chat message is promoted into a decision. */
  messageId: z.string().optional(),
  /** Optional accountable owner. */
  ownerId: z.string().optional(),
  /** Optional deadline (ISO timestamp). */
  dueAt: z.string().datetime().optional(),
});
export type CreateDecisionInput = z.infer<typeof CreateDecisionSchema>;

export const DecideSchema = z.object({
  outcome: z.string().min(1).max(2000),
});
export type DecideInput = z.infer<typeof DecideSchema>;

/** Assign or clear an owner and/or due date on an existing decision. */
export const AssignDecisionSchema = z.object({
  ownerId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export type AssignDecisionInput = z.infer<typeof AssignDecisionSchema>;

export interface DecisionUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DecisionDto {
  id: string;
  channelId: string;
  messageId: string | null;
  title: string;
  detail: string;
  status: DecisionStatus;
  outcome: string | null;
  owner: DecisionUserDto | null;
  dueAt: string | null;
  decidedBy: DecisionUserDto | null;
  decidedAt: string | null;
  createdBy: DecisionUserDto;
  createdAt: string;
}
