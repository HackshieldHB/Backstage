import { HUDDLE_STATUS, MEETING_STATUS, decideAutoStatus } from './auto-status.service';
import { busyFromMeetings } from '../calendar/calendar.service';

const NOW = Date.parse('2026-10-26T09:00:00Z');
const none = { emoji: null, expiresAt: null };
const manual = { emoji: '🌴', expiresAt: null };
const huddle = { emoji: HUDDLE_STATUS.emoji, expiresAt: new Date(NOW + 3600_000) };
const meeting = { emoji: MEETING_STATUS.emoji, expiresAt: new Date(NOW + 3600_000) };

describe('decideAutoStatus', () => {
  it('sets a status when there is none (or it expired)', () => {
    expect(decideAutoStatus(none, 'huddle', true, NOW)).toBe('set');
    expect(decideAutoStatus(none, 'meeting', true, NOW)).toBe('set');
    expect(
      decideAutoStatus({ emoji: '🌴', expiresAt: new Date(NOW - 1) }, 'meeting', true, NOW),
    ).toBe('set');
  });

  it('never replaces or clears a status set by hand', () => {
    expect(decideAutoStatus(manual, 'huddle', true, NOW)).toBe('keep');
    expect(decideAutoStatus(manual, 'meeting', true, NOW)).toBe('keep');
    expect(decideAutoStatus(manual, 'huddle', false, NOW)).toBe('keep');
    expect(decideAutoStatus(manual, 'meeting', false, NOW)).toBe('keep');
  });

  it('lets a huddle take over a meeting status, not the other way round', () => {
    expect(decideAutoStatus(meeting, 'huddle', true, NOW)).toBe('set');
    expect(decideAutoStatus(huddle, 'meeting', true, NOW)).toBe('keep');
  });

  it('only clears its own status', () => {
    expect(decideAutoStatus(huddle, 'huddle', false, NOW)).toBe('clear');
    expect(decideAutoStatus(meeting, 'huddle', false, NOW)).toBe('keep');
    expect(decideAutoStatus(meeting, 'meeting', false, NOW)).toBe('clear');
    expect(decideAutoStatus(huddle, 'meeting', false, NOW)).toBe('keep');
    expect(decideAutoStatus(none, 'huddle', false, NOW)).toBe('keep');
  });

  it('refreshes its own status while it lasts', () => {
    expect(decideAutoStatus(huddle, 'huddle', true, NOW)).toBe('set');
  });
});

describe('busyFromMeetings', () => {
  const now = new Date(NOW);
  const at = (minsFromNow: number) => new Date(NOW + minsFromNow * 60_000);

  it('counts the organiser and accepted guests of a meeting in progress', () => {
    const busy = busyFromMeetings(
      [
        {
          scheduledFor: at(-10),
          durationMins: 30,
          createdById: 'org',
          responses: [{ userId: 'guest' }],
        },
      ],
      now,
    );
    expect([...busy.keys()].sort()).toEqual(['guest', 'org']);
    expect(busy.get('org')).toEqual(at(20));
  });

  it('ignores meetings that ended or have not started, and defaults to an hour', () => {
    const busy = busyFromMeetings(
      [
        { scheduledFor: at(-90), durationMins: 30, createdById: 'ended', responses: [] },
        { scheduledFor: at(5), durationMins: 30, createdById: 'later', responses: [] },
        { scheduledFor: at(-50), durationMins: null, createdById: 'untimed', responses: [] },
      ],
      now,
    );
    expect([...busy.keys()]).toEqual(['untimed']);
    expect(busy.get('untimed')).toEqual(at(10));
  });

  it('keeps the latest end when meetings overlap, and can filter to one person', () => {
    const rows = [
      { scheduledFor: at(-5), durationMins: 15, createdById: 'a', responses: [{ userId: 'b' }] },
      { scheduledFor: at(-2), durationMins: 60, createdById: 'b', responses: [] },
    ];
    expect(busyFromMeetings(rows, now).get('b')).toEqual(at(58));
    expect([...busyFromMeetings(rows, now, 'a').keys()]).toEqual(['a']);
  });
});
