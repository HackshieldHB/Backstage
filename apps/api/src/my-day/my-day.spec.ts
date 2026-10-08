import type { JiraMyIssue, MyDayItemDto, TaskDto, WorkflowRequestDto } from '@backstages/shared';
import { applySuggestedOrder, buildFocus, localDay } from './my-day.service';
import { normalizeIcsUrl, parseIcs, unescapeIcs } from '../calendar/calendar.service';

const me = { id: 'me', displayName: 'Me', avatarUrl: null };

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: 't',
    workspaceId: 'w',
    title: 'Task',
    notes: '',
    status: 'OPEN',
    dueAt: null,
    assignee: me,
    createdBy: me,
    messageId: null,
    channelId: null,
    conversationId: null,
    meetingRecordId: null,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    jira: null,
    jiraSyncError: null,
    ...over,
  };
}

describe('localDay', () => {
  it('computes the local calendar day for an offset', () => {
    const now = new Date('2026-10-08T20:30:00Z');
    expect(localDay(now, 0)).toEqual({
      start: new Date('2026-10-08T00:00:00Z'),
      end: new Date('2026-10-09T00:00:00Z'),
      date: '2026-10-08',
    });
    // Jakarta (UTC+7): 20:30Z is already 03:30 on the 9th.
    const jkt = localDay(now, 420);
    expect(jkt.date).toBe('2026-10-09');
    expect(jkt.start.toISOString()).toBe('2026-10-08T17:00:00.000Z');
    // New York (UTC-4): still the 8th.
    expect(localDay(now, -240).date).toBe('2026-10-08');
  });
});

describe('buildFocus', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const dayEnd = new Date('2026-10-09T00:00:00Z');
  const jira = (over: Partial<JiraMyIssue>): JiraMyIssue => ({
    key: 'J-1',
    summary: 'Jira thing',
    status: 'To Do',
    priority: 'Medium',
    dueDate: null,
    overdue: false,
    url: 'https://x/browse/J-1',
    ...over,
  });
  const request: WorkflowRequestDto = {
    runId: 'r1',
    workflowName: 'Expense approval',
    kind: 'request_approval',
    prompt: 'Approve the taxi?',
    fields: [],
    requestedBy: null,
    createdAt: '2026-10-08T09:00:00Z',
    expiresAt: null,
  };

  it('orders requests, overdue, due today, high-priority Jira, soon, other Jira, later, undated', () => {
    const focus = buildFocus({
      now,
      dayEnd,
      today: '2026-10-08',
      requests: [request],
      tasks: [
        task({ id: 'undated', title: 'Someday' }),
        task({ id: 'later', dueAt: '2026-10-20T10:00:00Z' }),
        task({ id: 'soon', dueAt: '2026-10-09T15:00:00Z' }),
        task({ id: 'today', dueAt: '2026-10-08T16:00:00Z' }),
        task({ id: 'late', dueAt: '2026-10-07T16:00:00Z' }),
      ],
      jira: [
        jira({ key: 'J-PLAIN' }),
        jira({ key: 'J-HIGH', priority: 'High' }),
        jira({ key: 'J-LATE', dueDate: '2026-10-01' }),
        jira({ key: 'J-TODAY', dueDate: '2026-10-08' }),
      ],
    });
    expect(focus.map((f) => f.id)).toEqual([
      'request:r1',
      'task:late',
      'jira:J-LATE',
      'task:today',
      'jira:J-TODAY',
      'jira:J-HIGH',
      'task:soon',
      'jira:J-PLAIN',
      'task:later',
      'task:undated',
    ]);
    expect(focus[1]).toMatchObject({ reason: 'Overdue', overdue: true });
    expect(focus[2]).toMatchObject({ reason: 'Overdue in Jira', overdue: true });
    expect(focus[5].reason).toBe('High priority in Jira');
    expect(focus[0].reason).toBe('Someone is waiting on your approval');
  });

  it('caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) => task({ id: `t${i}` }));
    expect(
      buildFocus({ now, dayEnd, today: '2026-10-08', requests: [], jira: [], tasks: many }),
    ).toHaveLength(30);
  });
});

describe('applySuggestedOrder', () => {
  const items: MyDayItemDto[] = ['a', 'b', 'c'].map((id) => ({
    id,
    kind: 'task',
    title: id,
    detail: null,
    reason: `std ${id}`,
    overdue: false,
    due: null,
    url: null,
  }));

  it('follows the suggestion, drops unknown/duplicate ids, keeps skipped items at the end', () => {
    const out = applySuggestedOrder(items, [
      { id: 'c', reason: 'Quick win' },
      { id: 'ghost', reason: 'x' },
      { id: 'c', reason: 'again' },
      { id: 'a', reason: '' },
    ]);
    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(out[0].reason).toBe('Quick win');
    expect(out[1].reason).toBe('std a'); // empty AI reason keeps the standard one
    expect(out[2].reason).toBe('std b');
  });
});

describe('calendar parsing', () => {
  it('reads titles and unescapes ICS text', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261008T090000Z',
      'DTEND:20261008T093000Z',
      'SUMMARY:Standup\\, team A\\; daily',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261008T130000Z',
      'DTEND:20261008T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const events = parseIcs(ics);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Standup, team A; daily');
    expect(events[1].title).toBe('');
    expect(unescapeIcs('Line one\\nline two \\\\ end')).toBe('Line one line two \\ end');
  });

  it('turns webcal links into https', () => {
    expect(normalizeIcsUrl('webcal://cal.example.com/x.ics')).toBe('https://cal.example.com/x.ics');
    expect(normalizeIcsUrl('WEBCALS://cal.example.com/x.ics')).toBe(
      'https://cal.example.com/x.ics',
    );
    expect(normalizeIcsUrl('https://cal.example.com/x.ics')).toBe('https://cal.example.com/x.ics');
  });
});
