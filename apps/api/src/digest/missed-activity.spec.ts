import { composeMissedEmail, emailWorthy } from './missed-activity.service';

describe('missed-activity email', () => {
  it('only emails direct activity', () => {
    expect(emailWorthy('MENTION', null)).toBe(true);
    expect(emailWorthy('DM', null)).toBe(true);
    expect(emailWorthy('THREAD_REPLY', null)).toBe(true);
    expect(emailWorthy('REACTION', null)).toBe(false);
    expect(emailWorthy('CHANNEL_MESSAGE', null)).toBe(false);
    expect(emailWorthy('SYSTEM', { source: 'scheduled-huddle', kind: 'invite' })).toBe(true);
    expect(emailWorthy('SYSTEM', { source: 'scheduled-huddle', kind: 'reminder' })).toBe(false);
    expect(emailWorthy('SYSTEM', { source: 'task', action: 'assigned' })).toBe(true);
    expect(emailWorthy('SYSTEM', { source: 'task', action: 'completed' })).toBe(false);
    expect(emailWorthy('SYSTEM', { source: 'jira' })).toBe(false);
  });

  it('writes a readable email with previews, upcoming meetings and an unsubscribe link', () => {
    const { subject, body } = composeMissedEmail({
      displayName: 'Kevin',
      total: 7,
      items: [
        { type: 'MENTION', actorName: 'Alice', channelName: 'eng', preview: 'ship it?', payload: null },
        { type: 'DM', actorName: 'Bob', channelName: null, preview: null, payload: null },
        {
          type: 'SYSTEM',
          actorName: 'Carol',
          channelName: null,
          preview: null,
          payload: { source: 'scheduled-huddle', kind: 'invite', title: 'Sprint planning', startedBy: 'Carol' },
        },
      ],
      upcoming: [{ title: 'Standup', scheduledFor: new Date('2026-10-21T02:00:00Z'), timeZone: 'Asia/Jakarta' }],
      unsubscribeUrl: 'https://app.example/unsubscribe#token=abc',
    });
    expect(subject).toBe('You have 7 unread updates in Backstages');
    expect(body).toContain('• Alice mentioned you in #eng — “ship it?”');
    expect(body).toContain('• New message from Bob');
    expect(body).toContain('Carol invited you to “Sprint planning”');
    expect(body).toContain('• …and 4 more');
    expect(body).toContain('Standup — Wed 21 Oct, 09:00 (Asia/Jakarta)');
    expect(body).toContain('https://app.example/unsubscribe#token=abc');
  });

  it('uses the single item as the subject', () => {
    const { subject } = composeMissedEmail({
      displayName: 'K',
      total: 1,
      items: [{ type: 'DM', actorName: 'Bob', channelName: null, preview: 'hey there', payload: null }],
      upcoming: [],
      unsubscribeUrl: 'u',
    });
    expect(subject).toBe('New message from Bob');
  });
});
