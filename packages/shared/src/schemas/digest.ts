import { z } from 'zod';

/** Toggle the personal daily email digest for a workspace. */
export const DigestOptInSchema = z.object({
  optIn: z.boolean(),
  /** The member's UTC offset in minutes, so the digest fires in their local morning. */
  tzOffsetMin: z.number().int().min(-720).max(840).optional(),
});
export type DigestOptInInput = z.infer<typeof DigestOptInSchema>;

export interface DigestPrefDto {
  optIn: boolean;
}

// ---------------------------------------------------------------------------
// Missed-activity emails
// ---------------------------------------------------------------------------

export interface EmailPreferencesDto {
  /** Email me about mentions, DMs and invites I missed while away. */
  missedActivity: boolean;
}

export const EmailPreferencesSchema = z.object({ missedActivity: z.boolean() });
export type EmailPreferencesInput = z.infer<typeof EmailPreferencesSchema>;

/** One-click unsubscribe from an email link (no sign-in needed). */
export const EmailUnsubscribeSchema = z.object({ token: z.string().min(20).max(2000) });
export type EmailUnsubscribeInput = z.infer<typeof EmailUnsubscribeSchema>;
