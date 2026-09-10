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
