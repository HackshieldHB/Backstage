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

/** Create a scheduled huddle in a channel or DM. The target is taken from the
 *  route (channel/conversation id), so only the title/time/duration are posted. */
export const ScheduleHuddleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** ISO 8601 timestamp; must be in the future. */
  scheduledFor: z.string().datetime(),
  /** Planned length in minutes (informational). */
  durationMins: z.number().int().min(5).max(600).optional(),
});
export type ScheduleHuddleInput = z.infer<typeof ScheduleHuddleSchema>;

export interface ScheduledHuddleDto {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  title: string;
  scheduledFor: string;
  durationMins: number | null;
  createdById: string;
  createdByName: string;
  /** True once the "starting now" reminder has fired. */
  notified: boolean;
}
