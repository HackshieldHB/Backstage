import { z } from 'zod';

/** Queue a message for later delivery into the current channel/DM. */
export const ScheduleMessageSchema = z.object({
  contentJson: z.unknown(),
  contentText: z.string().min(1).max(40000),
  /** ISO 8601 timestamp; must be in the future. */
  scheduledFor: z.string().datetime(),
});
export type ScheduleMessageInput = z.infer<typeof ScheduleMessageSchema>;

export interface ScheduledMessageDto {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  contentText: string;
  scheduledFor: string;
  /** True when it has no channel/DM target — a personal /remind reminder. */
  isReminder: boolean;
}
