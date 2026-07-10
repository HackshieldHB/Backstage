import { z } from 'zod';

export const UpdateStatusSchema = z.object({
  statusEmoji: z.string().max(64).nullable(),
  statusText: z.string().max(100).nullable(),
  /** ISO timestamp after which the status auto-clears. */
  statusExpiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateStatusInput = z.infer<typeof UpdateStatusSchema>;

export const UpdatePresenceSchema = z.object({
  /** ACTIVE clears any manual override. */
  state: z.enum(['ACTIVE', 'AWAY', 'DND']),
});
export type UpdatePresenceInput = z.infer<typeof UpdatePresenceSchema>;

export const UpdateNotificationPrefSchema = z.object({
  pref: z.enum(['ALL', 'MENTIONS', 'MUTED']),
});
export type UpdateNotificationPrefInput = z.infer<typeof UpdateNotificationPrefSchema>;

export const MarkNotificationsReadSchema = z.object({
  /** Specific ids, or omit to mark everything read. */
  ids: z.array(z.string()).optional(),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadSchema>;
