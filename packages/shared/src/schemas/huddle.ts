import { z } from 'zod';

/** HTTP DTOs for huddle server actions (recap, transcript persistence). Realtime
 *  huddle events live in socket.ts. */

export const HuddleRecapSchema = z.object({
  channelId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  /** Concatenated in-meeting chat + notes to summarise. */
  transcript: z.string().min(1).max(20000),
  /** When true, the generated recap is also posted into the huddle's channel/DM. */
  post: z.boolean().optional(),
});
export type HuddleRecapInput = z.infer<typeof HuddleRecapSchema>;

export interface HuddleRecapDto {
  summary: string;
  actionItems: string[];
  /** True when the recap was posted into the channel/DM. */
  posted: boolean;
}

/** Persist the meeting notes into the channel/DM as a message. */
export const HuddleSaveNotesSchema = z.object({
  channelId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  notes: z.string().min(1).max(20000),
});
export type HuddleSaveNotesInput = z.infer<typeof HuddleSaveNotesSchema>;

// ---------------------------------------------------------------------------
// Scheduled huddles (DB-backed, queue-delivered reminders)
// ---------------------------------------------------------------------------

/** How long before the start the "starting soon" reminder can be sent (0 = none). */
export const MEETING_REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60] as const;
export const DEFAULT_MEETING_REMINDER_MINS = 10;

export const MeetingRecurrenceSchema = z.enum(['NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY']);
export type MeetingRecurrence = z.infer<typeof MeetingRecurrenceSchema>;

export const MeetingResponseSchema = z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']);
export type MeetingResponse = z.infer<typeof MeetingResponseSchema>;

const meetingFields = {
  title: z.string().trim().min(1).max(200),
  /** Agenda / notes shown in the invite. */
  description: z.string().trim().max(2000).optional(),
  /** ISO 8601 timestamp; must be in the future. */
  scheduledFor: z.string().datetime(),
  /** Planned length in minutes. */
  durationMins: z.number().int().min(5).max(600).optional(),
  /** Minutes before the start to remind guests; 0 turns the early reminder off. */
  reminderMins: z
    .number()
    .int()
    .refine((n) => (MEETING_REMINDER_OPTIONS as readonly number[]).includes(n), 'Unsupported reminder')
    .optional(),
  recurrence: MeetingRecurrenceSchema.optional(),
  /** Organiser's IANA time zone (keeps a recurring meeting on the same local time). */
  timeZone: z.string().max(64).optional(),
};

/** Create a scheduled huddle (meeting) in a channel or DM. The target is taken
 *  from the route (channel/conversation id). */
export const ScheduleHuddleSchema = z.object(meetingFields);
export type ScheduleHuddleInput = z.infer<typeof ScheduleHuddleSchema>;

/** Edit a scheduled meeting (organiser only). Any subset of the create fields;
 *  `description: ''` clears the agenda. */
export const UpdateScheduledHuddleSchema = z
  .object(meetingFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type UpdateScheduledHuddleInput = z.infer<typeof UpdateScheduledHuddleSchema>;

export const RespondScheduledHuddleSchema = z.object({ response: MeetingResponseSchema });
export type RespondScheduledHuddleInput = z.infer<typeof RespondScheduledHuddleSchema>;

export interface ScheduledHuddleDto {
  /** Row id, or `<rowId>@<iso start>` for a projected future occurrence of a
   *  recurring meeting (see `virtual`). */
  id: string;
  /** The stored row this entry comes from (equal to `id` unless `virtual`). */
  sourceId: string;
  /** True for a future occurrence of a recurring meeting that isn't stored yet:
   *  it can be viewed but not answered or cancelled on its own. */
  virtual: boolean;
  workspaceId: string;
  channelId: string | null;
  /** Channel name, or the other guests' names for a DM (as the viewer sees it). */
  locationName: string;
  conversationId: string | null;
  title: string;
  description: string | null;
  scheduledFor: string;
  durationMins: number | null;
  reminderMins: number;
  recurrence: MeetingRecurrence;
  timeZone: string | null;
  seriesId: string | null;
  createdById: string;
  createdByName: string;
  /** True once the "starting now" reminder has fired. */
  notified: boolean;
  /** The viewer's RSVP (null = not answered). */
  myResponse: MeetingResponse | null;
}

export interface MeetingGuestDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  response: MeetingResponse | null;
  isOrganizer: boolean;
}

export interface ScheduledHuddleDetailDto extends ScheduledHuddleDto {
  guests: MeetingGuestDto[];
}
