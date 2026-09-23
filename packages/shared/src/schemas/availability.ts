import { z } from 'zod';

/** Personal focus/working-hours + out-of-office preferences (per workspace member). */
export const AvailabilitySchema = z.object({
  /** Minutes from local midnight; null clears working hours (always available). */
  workStartMin: z.number().int().min(0).max(1439).nullable().optional(),
  workEndMin: z.number().int().min(1).max(1440).nullable().optional(),
  /** Local weekdays that count as working days (0=Sun..6=Sat). */
  workDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  /** Out-of-office end time (ISO). Null clears OOO. */
  oooUntil: z.string().datetime().nullable().optional(),
  oooMessage: z.string().max(280).nullable().optional(),
});
export type AvailabilityInput = z.infer<typeof AvailabilitySchema>;

export interface AvailabilityDto {
  workStartMin: number | null;
  workEndMin: number | null;
  workDays: number[] | null;
  /** The member's stored UTC offset in minutes (shared with the daily digest). */
  tzOffsetMin: number;
  oooUntil: string | null;
  oooMessage: string | null;
}
