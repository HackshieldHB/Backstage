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
