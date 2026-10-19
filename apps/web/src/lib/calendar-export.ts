import type { MeetingRecurrence, ScheduledHuddleDto } from '@backstages/shared';

/**
 * Hand a Backstages meeting to the user's own calendar: an .ics file (Apple /
 * Outlook / any client) or a prefilled Google Calendar "create event" link.
 * Both carry a link back to the meeting's channel/DM, where the huddle runs.
 */

const DEFAULT_MINS = 30;

function endOf(m: ScheduledHuddleDto): Date {
  return new Date(new Date(m.scheduledFor).getTime() + (m.durationMins ?? DEFAULT_MINS) * 60_000);
}

/** 20261019T020000Z */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 20261019T090000 — wall time in `tz` (no Z), or null if the zone is unknown. */
function localDate(d: Date, tz: string | null): string | null {
  if (!tz) return null;
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    return `${g('year')}${g('month')}${g('day')}T${g('hour')}${g('minute')}${g('second')}`;
  } catch {
    return null;
  }
}

/** RFC 5545 TEXT escaping. */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (approximated by characters). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function rrule(r: MeetingRecurrence): string | null {
  if (r === 'DAILY') return 'FREQ=DAILY';
  if (r === 'WEEKDAYS') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (r === 'WEEKLY') return 'FREQ=WEEKLY';
  return null;
}

/** Deep link to the meeting's channel/DM in this Backstages instance. */
export function meetingLink(m: ScheduledHuddleDto): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const c = m.channelId ?? m.conversationId ?? '';
  return `${origin}/app?ws=${m.workspaceId}&c=${c}&t=${m.channelId ? 'ch' : 'dm'}`;
}

function details(m: ScheduledHuddleDto): string {
  const parts = [m.description?.trim(), `Join the huddle in Backstages: ${meetingLink(m)}`];
  return parts.filter(Boolean).join('\n\n');
}

export function buildIcs(m: ScheduledHuddleDto): string {
  const start = new Date(m.scheduledFor);
  const end = endOf(m);
  const rule = rrule(m.recurrence);
  // With a known zone, use local wall times so a recurrence ("weekdays") is
  // evaluated in the organiser's zone rather than in UTC.
  const localStart = localDate(start, m.timeZone);
  const localEnd = localDate(end, m.timeZone);
  const when =
    localStart && localEnd
      ? [`DTSTART;TZID=${m.timeZone}:${localStart}`, `DTEND;TZID=${m.timeZone}:${localEnd}`]
      : [`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Backstages//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Same UID for every occurrence of a series so re-imports update, not duplicate.
    `UID:${m.seriesId ?? m.sourceId}@backstages`,
    `DTSTAMP:${icsDate(new Date())}`,
    ...when,
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText(details(m))}`,
    `LOCATION:${icsText(m.channelId ? `Backstages · #${m.locationName}` : 'Backstages huddle')}`,
    `URL:${meetingLink(m)}`,
    ...(rule ? [`RRULE:${rule}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(m.title)}`,
    `TRIGGER:-PT${m.reminderMins > 0 ? m.reminderMins : 10}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(m: ScheduledHuddleDto): void {
  const blob = new Blob([buildIcs(m)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${m.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'meeting'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl(m: ScheduledHuddleDto): string {
  const start = new Date(m.scheduledFor);
  const end = endOf(m);
  const localStart = localDate(start, m.timeZone);
  const localEnd = localDate(end, m.timeZone);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: localStart && localEnd ? `${localStart}/${localEnd}` : `${icsDate(start)}/${icsDate(end)}`,
    details: details(m),
    location: m.channelId ? `Backstages · #${m.locationName}` : 'Backstages huddle',
  });
  // Local times (no Z) are read in `ctz`, which also anchors the recurrence.
  if (localStart && localEnd && m.timeZone) params.set('ctz', m.timeZone);
  const rule = rrule(m.recurrence);
  if (rule) params.set('recur', `RRULE:${rule}`);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
