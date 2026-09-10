import { bucketJql, recentOpenJql } from './dashboard.service';

const ACC = '557058:abc-123';

describe('bucketJql', () => {
  it('builds the server-owned literals for all-scope', () => {
    expect(bucketJql('todo', null)).toBe('statusCategory = "To Do"');
    expect(bucketJql('inProgress', null)).toBe('statusCategory = "In Progress"');
    expect(bucketJql('resolvedLast7d', null)).toBe('statusCategory = Done AND statusCategoryChangedDate >= -7d');
    expect(bucketJql('createdLast7d', null)).toBe('created >= -7d');
    expect(bucketJql('overdue', null)).toBe('duedate < now() AND statusCategory != Done');
    expect(bucketJql('dueThisWeek', null)).toBe('duedate >= now() AND duedate <= endOfWeek() AND statusCategory != Done');
    expect(bucketJql('unassigned', null)).toBe('assignee IS EMPTY AND statusCategory != Done');
  });

  it('appends the assignee filter for "mine" scope', () => {
    expect(bucketJql('todo', ACC)).toBe(`statusCategory = "To Do" AND assignee = "${ACC}"`);
    expect(bucketJql('overdue', ACC)).toBe(`duedate < now() AND statusCategory != Done AND assignee = "${ACC}"`);
  });

  it('makes "unassigned" intentionally empty in "mine" scope (nobody owns an unassigned issue)', () => {
    // A contradiction → 0 results, which is the correct, safe answer.
    expect(bucketJql('unassigned', ACC)).toBe(`assignee = "${ACC}" AND assignee IS EMPTY`);
  });
});

describe('recentOpenJql', () => {
  it('orders open issues by recency, optionally scoped to the caller', () => {
    expect(recentOpenJql(null)).toBe('statusCategory != Done ORDER BY updated DESC');
    expect(recentOpenJql(ACC)).toBe(`statusCategory != Done AND assignee = "${ACC}" ORDER BY updated DESC`);
  });
});
