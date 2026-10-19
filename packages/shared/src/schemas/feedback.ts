import { z } from 'zod';

// ---------------------------------------------------------------------------
// In-app feedback
// ---------------------------------------------------------------------------

export const FeedbackCategorySchema = z.enum(['BUG', 'IDEA', 'OTHER']);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

export const SendFeedbackSchema = z.object({
  category: FeedbackCategorySchema,
  message: z.string().trim().min(3).max(4000),
  /** App path + query it was sent from (never a full URL with origin). */
  page: z.string().max(500).optional(),
});
export type SendFeedbackInput = z.infer<typeof SendFeedbackSchema>;

export interface FeedbackDto {
  id: string;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  createdAt: string;
  user: { id: string; displayName: string; avatarUrl: string | null };
}

// ---------------------------------------------------------------------------
// Feature-usage analytics
// ---------------------------------------------------------------------------

/** "area:thing" — lowercase letters, digits, and . _ - : only. */
export const USAGE_EVENT_NAME = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export const TrackUsageSchema = z.object({
  events: z
    .array(z.object({ name: z.string().regex(USAGE_EVENT_NAME) }))
    .min(1)
    .max(50),
});
export type TrackUsageInput = z.infer<typeof TrackUsageSchema>;

export interface FeatureUsageDto {
  name: string;
  /** Times used in the window. */
  count: number;
  /** Distinct people who used it in the window. */
  users: number;
}
