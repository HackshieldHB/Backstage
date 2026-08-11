import { z } from 'zod';

/** HH:MM in the schedule's local time (see `tzOffsetMin`). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CreateStandupSchema = z.object({
  name: z.string().min(1).max(80),
  /** Channel the daily digest/prompt is posted to. */
  channelId: z.string().min(1),
  timeOfDay: z.string().regex(TIME_RE),
  /** Weekdays it runs: 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  /** Minutes east of UTC for the schedule's local time (e.g. Jakarta = 420). */
  tzOffsetMin: z.number().int().min(-720).max(840).default(0),
  memberIds: z.array(z.string()).default([]),
});
export type CreateStandupInput = z.infer<typeof CreateStandupSchema>;

export const UpdateStandupSchema = z
  .object({
    name: z.string().min(1).max(80),
    channelId: z.string().min(1),
    timeOfDay: z.string().regex(TIME_RE),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    tzOffsetMin: z.number().int().min(-720).max(840),
    memberIds: z.array(z.string()),
    active: z.boolean(),
  })
  .partial();
export type UpdateStandupInput = z.infer<typeof UpdateStandupSchema>;

export const SubmitCheckinSchema = z.object({
  yesterday: z.string().max(4000).default(''),
  today: z.string().max(4000).default(''),
  blockers: z.string().max(4000).optional(),
});
export type SubmitCheckinInput = z.infer<typeof SubmitCheckinSchema>;

export interface StandupMemberDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface StandupDto {
  id: string;
  name: string;
  channelId: string;
  timeOfDay: string;
  days: number[];
  tzOffsetMin: number;
  active: boolean;
  members: StandupMemberDto[];
}

export interface StandupResponseDto {
  id: string;
  standupId: string;
  onDate: string;
  user: StandupMemberDto;
  yesterday: string;
  today: string;
  blockers: string | null;
  createdAt: string;
}

/** Auto-pulled recent activity to help a member fill their check-in. */
export interface StandupPrefillDto {
  /** Jira issue keys the person touched in the window. */
  jiraIssues: string[];
  /** Human-readable activity lines, e.g. "2h 15m in huddles". */
  summary: string[];
}
