import { z } from 'zod';

export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const INCIDENT_STATUSES = ['OPEN', 'MITIGATED', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_UPDATE_KINDS = ['NOTE', 'STATUS', 'MITIGATED', 'RESOLVED'] as const;
export type IncidentUpdateKind = (typeof INCIDENT_UPDATE_KINDS)[number];

export const OpenIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(SEVERITIES).default('SEV3'),
  channelId: z.string().optional(),
  commanderId: z.string().optional(),
  jiraIssueKey: z.string().optional(),
});
export type OpenIncidentInput = z.infer<typeof OpenIncidentSchema>;

export const IncidentUpdateSchema = z.object({
  kind: z.enum(INCIDENT_UPDATE_KINDS).default('NOTE'),
  body: z.string().min(1).max(2000),
});
export type IncidentUpdateInput = z.infer<typeof IncidentUpdateSchema>;

export const CreateOncallShiftSchema = z.object({
  userId: z.string().min(1),
  label: z.string().max(60).default('Primary'),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});
export type CreateOncallShiftInput = z.infer<typeof CreateOncallShiftSchema>;

export interface IncidentUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}
export interface IncidentUpdateDto {
  id: string;
  kind: IncidentUpdateKind;
  body: string;
  author: IncidentUserDto | null;
  createdAt: string;
}
export interface IncidentDto {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  channelId: string | null;
  jiraIssueKey: string | null;
  commander: IncidentUserDto | null;
  declaredBy: IncidentUserDto;
  declaredAt: string;
  resolvedAt: string | null;
  /** Minutes from declared to resolved (null while open). */
  durationMin: number | null;
  updates: IncidentUpdateDto[];
}

export interface OncallShiftDto {
  id: string;
  user: IncidentUserDto;
  label: string;
  startsAt: string;
  endsAt: string;
}
export interface OncallDto {
  current: OncallShiftDto[];
  upcoming: OncallShiftDto[];
}
