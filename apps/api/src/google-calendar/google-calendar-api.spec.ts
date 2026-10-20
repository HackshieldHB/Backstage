import { eventBodyFor, hashEvent } from './google-calendar-api';

const meeting = {
  id: 'm1',
  title: 'Standup',
  description: 'Yesterday / today / blockers',
  scheduledFor: new Date('2026-10-22T02:00:00Z'),
  durationMins: 15,
  reminderMins: 10,
  timeZone: 'Asia/Jakarta',
  locationName: '#eng',
  link: 'https://chat.example/app?ws=w&c=c&t=ch',
};

describe('eventBodyFor', () => {
  it('mirrors the meeting, tagged as ours, with no attendees', () => {
    const body = eventBodyFor(meeting);
    expect(body).toEqual({
      summary: 'Standup',
      description: 'Yesterday / today / blockers\n\nJoin the huddle in Backstages: https://chat.example/app?ws=w&c=c&t=ch',
      location: 'Backstages · #eng',
      start: { dateTime: '2026-10-22T02:00:00.000Z', timeZone: 'Asia/Jakarta' },
      end: { dateTime: '2026-10-22T02:15:00.000Z', timeZone: 'Asia/Jakarta' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      source: { title: 'Backstages', url: meeting.link },
      extendedProperties: { private: { backstagesMeetingId: 'm1' } },
    });
    expect(body).not.toHaveProperty('attendees');
  });

  it('defaults the length, drops the reminder when off, and falls back to UTC', () => {
    const body = eventBodyFor({ ...meeting, durationMins: null, reminderMins: 0, timeZone: 'Not/AZone', description: null });
    expect(body.end.dateTime).toBe('2026-10-22T02:30:00.000Z');
    expect(body.reminders.overrides).toEqual([]);
    expect(body.start.timeZone).toBe('UTC');
    expect(body.description).toBe('Join the huddle in Backstages: https://chat.example/app?ws=w&c=c&t=ch');
  });

  it('hashes content so unchanged meetings are not rewritten', () => {
    expect(hashEvent(eventBodyFor(meeting))).toBe(hashEvent(eventBodyFor({ ...meeting })));
    expect(hashEvent(eventBodyFor(meeting))).not.toBe(hashEvent(eventBodyFor({ ...meeting, title: 'Standup!' })));
  });
});
