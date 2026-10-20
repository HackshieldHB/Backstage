import { createHash } from 'crypto';

/** Google Calendar v3 REST — the handful of calls we need. */

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 10_000;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let message = `Google Calendar ${method} ${path.split('?')[0]}: HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* keep status text */
    }
    throw new GoogleApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** The meeting fields that go into a Google event. */
export interface MeetingForCalendar {
  id: string;
  title: string;
  description: string | null;
  scheduledFor: Date;
  durationMins: number | null;
  reminderMins: number;
  timeZone: string | null;
  locationName: string;
  link: string;
}

export interface GoogleEventBody {
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  source: { title: string; url: string };
  extendedProperties: { private: { backstagesMeetingId: string } };
}

const validTz = (tz: string | null) => {
  try {
    if (tz) {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    }
  } catch {
    /* fall through */
  }
  return 'UTC';
};

/**
 * The Google event mirroring a Backstages meeting. Marked with a private
 * extended property so we can recognise (and skip) our own copies when reading
 * the person's calendar back. No attendees: each guest gets their own copy, so
 * Google never emails anybody on our behalf.
 */
export function eventBodyFor(m: MeetingForCalendar): GoogleEventBody {
  const tz = validTz(m.timeZone);
  const end = new Date(m.scheduledFor.getTime() + (m.durationMins ?? 30) * 60_000);
  const description = [m.description?.trim(), `Join the huddle in Backstages: ${m.link}`].filter(Boolean).join('\n\n');
  return {
    summary: m.title,
    description,
    location: m.locationName ? `Backstages · ${m.locationName}` : 'Backstages',
    start: { dateTime: m.scheduledFor.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    reminders: { useDefault: false, overrides: m.reminderMins > 0 ? [{ method: 'popup', minutes: m.reminderMins }] : [] },
    source: { title: 'Backstages', url: m.link },
    extendedProperties: { private: { backstagesMeetingId: m.id } },
  };
}

export function hashEvent(body: GoogleEventBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export async function insertEvent(token: string, calendarId: string, body: GoogleEventBody): Promise<{ id: string }> {
  const res = await call<{ id: string }>(token, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, body);
  if (!res?.id) throw new GoogleApiError(500, 'Google did not return an event id');
  return res;
}

export async function patchEvent(token: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<void> {
  await call(token, 'PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, body);
}

/** Delete; an event that's already gone counts as deleted. */
export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await call(token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`);
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

interface RawGoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  eventType?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarEvent {
  start: number;
  end: number;
  title: string;
  allDay: boolean;
  /** Counts as busy time (not "free"/transparent). */
  busy: boolean;
  /** An all-day "out of office" block. */
  outOfOffice: boolean;
}

/** Events between [from, to): recurring ones expanded, cancelled and our own copies skipped. */
export async function listEvents(token: string, calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await call<{ items?: RawGoogleEvent[] }>(token, 'GET', `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  const out: CalendarEvent[] = [];
  for (const e of res?.items ?? []) {
    if (e.status === 'cancelled') continue;
    if (e.extendedProperties?.private?.backstagesMeetingId) continue; // our own copy
    const allDay = !e.start?.dateTime && !!e.start?.date;
    const start = allDay ? Date.parse(`${e.start!.date}T00:00:00Z`) : Date.parse(e.start?.dateTime ?? '');
    const end = allDay ? Date.parse(`${e.end?.date ?? e.start!.date}T00:00:00Z`) : Date.parse(e.end?.dateTime ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({
      start,
      end,
      title: (e.summary ?? '').slice(0, 200),
      allDay,
      busy: e.transparency !== 'transparent',
      outOfOffice: e.eventType === 'outOfOffice',
    });
  }
  return out;
}

/** Ids of the copies Backstages made in this calendar between [from, to) (all pages). */
export async function listOurEventIds(token: string, calendarId: string, from: Date, to: Date): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await call<{ items?: RawGoogleEvent[]; nextPageToken?: string }>(
      token,
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    for (const e of res?.items ?? []) {
      if (e.status !== 'cancelled' && e.extendedProperties?.private?.backstagesMeetingId) ids.add(e.id);
    }
    pageToken = res?.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}
