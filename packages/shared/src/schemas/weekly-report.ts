import { z } from 'zod';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CreateWeeklyReportSchema = z.object({
  channelId: z.string().min(1),
  dayOfWeek: z.number().int().min(0).max(6),
  timeOfDay: z.string().regex(TIME_RE),
  tzOffsetMin: z.number().int().min(-720).max(840).default(0),
});
export type CreateWeeklyReportInput = z.infer<typeof CreateWeeklyReportSchema>;

export const UpdateWeeklyReportSchema = z
  .object({
    channelId: z.string().min(1),
    dayOfWeek: z.number().int().min(0).max(6),
    timeOfDay: z.string().regex(TIME_RE),
    tzOffsetMin: z.number().int().min(-720).max(840),
    active: z.boolean(),
  })
  .partial();
export type UpdateWeeklyReportInput = z.infer<typeof UpdateWeeklyReportSchema>;

export interface WeeklyReportDto {
  id: string;
  channelId: string;
  dayOfWeek: number;
  timeOfDay: string;
  tzOffsetMin: number;
  active: boolean;
}

/** A rendered draft of the report text (AI-narrated when configured). */
export interface WeeklyReportPreviewDto {
  text: string;
  /** True when the narrative came from the AI model rather than the stats fallback. */
  aiGenerated: boolean;
}
