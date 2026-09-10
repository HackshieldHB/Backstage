import { z } from 'zod';

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const CreateProjectSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(120),
  jiraProjectKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9]+$/, 'Jira project key like "KAN"')
    .optional(),
  channelId: z.string().optional(),
  billRateCents: z.number().int().min(0).max(100_000_00).default(0),
  costRateCents: z.number().int().min(0).max(100_000_00).default(0),
  budgetHours: z.number().int().min(0).max(1_000_000).optional(),
  billable: z.boolean().default(true),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(120),
    jiraProjectKey: z.string().regex(/^[A-Z][A-Z0-9]+$/).nullable(),
    channelId: z.string().nullable(),
    billRateCents: z.number().int().min(0).max(100_000_00),
    costRateCents: z.number().int().min(0).max(100_000_00),
    budgetHours: z.number().int().min(0).max(1_000_000).nullable(),
    billable: z.boolean(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export interface ProjectRollupDto {
  id: string;
  clientId: string;
  name: string;
  jiraProjectKey: string | null;
  channelId: string | null;
  billRateCents: number;
  costRateCents: number;
  budgetHours: number | null;
  billable: boolean;
  archived: boolean;
  /** Seconds logged to this project's Jira key in the window. */
  loggedSec: number;
  billableSec: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  /** 0–100+ of budget consumed, or null when no budget is set. */
  budgetUsedPct: number | null;
}

export interface ClientRollupDto {
  id: string;
  name: string;
  projectCount: number;
  loggedSec: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  projects: ProjectRollupDto[];
}

export interface ProjectsOverviewDto {
  windowDays: number;
  totals: { loggedSec: number; revenueCents: number; costCents: number; marginCents: number };
  clients: ClientRollupDto[];
}
