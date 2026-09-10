import { z } from 'zod';

/** Link a calendar via a public ICS feed URL (Google/Outlook "secret address in
 *  iCal format"). The server polls it to set an "In a meeting" status. */
export const CalendarLinkSchema = z.object({
  icsUrl: z.string().url().max(2000),
});
export type CalendarLinkInput = z.infer<typeof CalendarLinkSchema>;

export interface CalendarLinkDto {
  linked: boolean;
  icsUrl: string | null;
  lastSyncAt: string | null;
  /** Whether the user is currently in a calendar event (from the latest sync). */
  inMeeting: boolean;
}
