import { z } from 'zod';

/**
 * Activity taxonomy for the team timeline. All kinds except WORK_LOGGED are
 * derived from real-time signals (huddle, presence, Jira status, Confluence,
 * chat) and are bounded by a member's online time, so they can be resolved into
 * a single non-overlapping timeline. WORK_LOGGED is explicit, possibly-backdated
 * Jira worklog time and is reported separately (never mixed into the online
 * resolver, which would let a day exceed 24h).
 */
export const ACTIVITY_KINDS = [
  'MEETING',
  'IMPLEMENTATION',
  'DOCUMENTATION',
  'COLLABORATION',
  'WORK_LOGGED',
  'ONLINE',
  'AWAY',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Higher wins when several real-time activities overlap in the same instant. */
export const ACTIVITY_PRIORITY: Record<ActivityKind, number> = {
  MEETING: 5,
  IMPLEMENTATION: 4,
  DOCUMENTATION: 3,
  COLLABORATION: 2,
  AWAY: 1,
  ONLINE: 0,
  WORK_LOGGED: -1, // reported separately, excluded from the online resolver
};

// ---------- log time (native Jira worklog) ----------

export const LogTimeSchema = z.object({
  /** Jira issue key, e.g. PROJ-123. */
  issueKey: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]+-\d+$/, 'Expected an issue key like PROJ-123'),
  /** Time spent, in minutes (Jira's minimum granularity is 1 minute). */
  minutes: z.coerce.number().int().min(1).max(24 * 60),
  /** When the work started; defaults to now on the server. */
  startedAt: z.string().datetime().optional(),
  comment: z.string().max(4000).optional(),
});
export type LogTimeInput = z.infer<typeof LogTimeSchema>;

export interface TimesheetEntryDto {
  id: string;
  issueKey: string;
  startedAt: string;
  minutes: number;
  comment: string | null;
  /** True once the entry has been pushed to Jira as a worklog. */
  synced: boolean;
  createdAt: string;
}

// ---------- timeline ----------

/** One resolved (non-overlapping) block on a member's timeline. */
export interface TimelineSegmentDto {
  kind: ActivityKind;
  startedAt: string;
  endedAt: string;
}

export interface TimelineMemberDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  segments: TimelineSegmentDto[];
}

export interface TimelineResponse {
  from: string;
  to: string;
  members: TimelineMemberDto[];
}

// ---------- utilization ----------

/** Per-member totals over the requested window, in seconds. */
export interface UtilizationRowDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  meetingSec: number;
  implementationSec: number;
  documentationSec: number;
  collaborationSec: number;
  /** Online but with no tracked activity — labelled "No tracked activity" in UI. */
  idleSec: number;
  awaySec: number;
  onlineSec: number;
  /** Explicit Jira worklog time (reported separately, may exceed online time). */
  loggedSec: number;
}

export interface UtilizationResponse {
  from: string;
  to: string;
  rows: UtilizationRowDto[];
}
