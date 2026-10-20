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

// ---------------------------------------------------------------------------
// Calendar sharing (see teammates' calendars)
// ---------------------------------------------------------------------------

/** PRIVATE: only you. FREE_BUSY: teammates see busy blocks, no titles.
 *  DETAILS: titles too — but only for meetings the viewer could open anyway. */
export const CalendarVisibilitySchema = z.enum(['PRIVATE', 'FREE_BUSY', 'DETAILS']);
export type CalendarVisibility = z.infer<typeof CalendarVisibilitySchema>;

export const CalendarSharingSchema = z.object({ visibility: CalendarVisibilitySchema });
export type CalendarSharingInput = z.infer<typeof CalendarSharingSchema>;

export interface CalendarSharingDto {
  visibility: CalendarVisibility;
}

/** A teammate who shares their calendar with the workspace. */
export interface SharedCalendarPersonDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  visibility: Exclude<CalendarVisibility, 'PRIVATE'>;
}

export interface SharedCalendarEventDto {
  start: string;
  end: string;
  /** Null when hidden: free/busy sharing, or a meeting the viewer can't open. */
  title: string | null;
  source: 'meeting' | 'external';
  /** Set only when the viewer can open the meeting themselves. */
  meetingId: string | null;
  /** The owner answered "maybe" (shown lighter). */
  tentative: boolean;
}

export interface PersonCalendarDto {
  userId: string;
  visibility: CalendarVisibility;
  events: SharedCalendarEventDto[];
  /** Their external calendar feed couldn't be read right now (meetings still shown). */
  externalUnavailable: boolean;
}

// ---------------------------------------------------------------------------
// Google Calendar (two-way)
// ---------------------------------------------------------------------------

export interface GoogleCalendarStatusDto {
  /** GOOGLE_CLIENT_ID/SECRET are configured on the server. */
  available: boolean;
  connected: boolean;
  /** The Google account whose calendar is connected. */
  email: string | null;
  /** Copy my Backstages meetings into this calendar. */
  pushMeetings: boolean;
  /** Google rejected our access (revoked) — reconnect to resume syncing. */
  broken: boolean;
  lastSyncedAt: string | null;
}

export const UpdateGoogleCalendarSchema = z.object({ pushMeetings: z.boolean() });
export type UpdateGoogleCalendarInput = z.infer<typeof UpdateGoogleCalendarSchema>;

export const GoogleCalendarConfirmSchema = z.object({ code: z.string().min(20).max(200) });
export type GoogleCalendarConfirmInput = z.infer<typeof GoogleCalendarConfirmSchema>;

/** My own external calendar events (Google or ICS) for the calendar view. */
export interface MyExternalEventsDto {
  source: 'google' | 'ics' | 'none';
  events: { start: string; end: string; title: string; allDay: boolean }[];
  /** The calendar couldn't be read right now. */
  unavailable: boolean;
}
