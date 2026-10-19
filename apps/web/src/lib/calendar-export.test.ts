import { describe, it, expect } from 'vitest';
import type { ScheduledHuddleDto } from '@backstages/shared';
import { buildIcs, googleCalendarUrl } from './calendar-export';

const meeting: ScheduledHuddleDto = {
  id: 'h1',
  sourceId: 'h1',
  virtual: false,
  workspaceId: 'w1',
  channelId: 'c1',
  conversationId: null,
  locationName: 'eng',
  title: 'Sprint sync; planning, Q4',
  description: 'Line one\nLine two',
  scheduledFor: '2026-10-26T02:00:00.000Z', // Mon 09:00 Jakarta
  durationMins: 45,
  reminderMins: 15,
  recurrence: 'WEEKDAYS',
  timeZone: 'Asia/Jakarta',
  seriesId: 's1',
  createdById: 'u1',
  createdByName: 'Ada',
  notified: false,
  myResponse: null,
};

describe('buildIcs', () => {
  it('uses local times in the organiser zone so the weekday rule is evaluated there', () => {
    const ics = buildIcs(meeting);
    expect(ics).toContain('DTSTART;TZID=Asia/Jakarta:20261026T090000');
    expect(ics).toContain('DTEND;TZID=Asia/Jakarta:20261026T094500');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(ics).toContain('UID:s1@backstages');
  });

  it('escapes text, adds the reminder alarm and uses CRLF', () => {
    const ics = buildIcs(meeting);
    expect(ics).toContain('SUMMARY:Sprint sync\\; planning\\, Q4');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('falls back to UTC when the zone is unknown, with no RRULE for one-offs', () => {
    const ics = buildIcs({ ...meeting, timeZone: null, recurrence: 'NONE' });
    expect(ics).toContain('DTSTART:20261026T020000Z');
    expect(ics).not.toContain('RRULE');
  });
});

describe('googleCalendarUrl', () => {
  it('prefills local times with the zone and recurrence', () => {
    const url = new URL(googleCalendarUrl(meeting));
    expect(url.searchParams.get('dates')).toBe('20261026T090000/20261026T094500');
    expect(url.searchParams.get('ctz')).toBe('Asia/Jakarta');
    expect(url.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(url.searchParams.get('text')).toBe(meeting.title);
  });
});
