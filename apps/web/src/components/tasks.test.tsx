import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TaskDto } from '@backstages/shared';
import { bucketOf, dueFromDateInput, dueLabel } from './tasks-pane';
import { reminderPresets, titleFromMessage } from './message-task-dialogs';
import { taskOrReminderText } from '@/lib/notification-text';

const me = { id: 'me', displayName: 'Me Myself', avatarUrl: null };
const other = { id: 'u2', displayName: 'Bob Stone', avatarUrl: null };

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: Math.random().toString(36).slice(2),
    workspaceId: 'w1',
    title: 'A task',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jira: null,
    jiraSyncError: null,
    ...over,
  };
}

describe('task date helpers', () => {
  it('a date pick means 17:00 local on that day', () => {
    const iso = dueFromDateInput('2026-10-07')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 9, 7, 17, 0,
    ]);
    expect(dueFromDateInput('')).toBeUndefined();
    expect(dueFromDateInput('garbage')).toBeUndefined();
  });

  it('buckets open tasks by due date', () => {
    const now = new Date();
    expect(bucketOf(task({ dueAt: null }), now)).toBe('someday');
    expect(bucketOf(task({ dueAt: new Date(now.getTime() - 60_000).toISOString() }), now)).toBe(
      'overdue',
    );
    expect(
      bucketOf(task({ dueAt: new Date(now.getTime() + 3 * 86_400_000).toISOString() }), now),
    ).toBe('upcoming');
  });

  it('labels today and tomorrow', () => {
    const today = new Date();
    today.setHours(23, 0, 0, 0);
    expect(dueLabel(today.toISOString())).toBe('Today');
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(dueLabel(tomorrow.toISOString())).toBe('Tomorrow');
  });
});

describe('message → task / reminder helpers', () => {
  it('flattens and truncates message text into a title', () => {
    expect(titleFromMessage('  fix\n the   build ')).toBe('fix the build');
    const long = titleFromMessage('x'.repeat(200));
    expect(long).toHaveLength(118);
    expect(long.endsWith('…')).toBe(true);
  });

  it('reminder presets are all in the future and in order', () => {
    for (const day of [0, 1, 3, 6]) {
      // A fixed week: 2026-10-04 is a Sunday.
      const now = new Date(2026, 9, 4 + day, 22, 30);
      const presets = reminderPresets(now);
      expect(presets).toHaveLength(5);
      for (const p of presets) expect(p.at.getTime()).toBeGreaterThan(now.getTime());
      const monday = presets[4].at;
      expect(monday.getDay()).toBe(1);
      expect(monday.getHours()).toBe(9);
      // "Next Monday" is within the coming week, never today.
      const days = (monday.getTime() - now.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(7);
    }
  });
});

describe('taskOrReminderText', () => {
  it('describes task and reminder notifications, ignores others', () => {
    expect(taskOrReminderText({ source: 'task', action: 'assigned', title: 'Ship' }, 'Ada')).toBe(
      'Ada assigned you “Ship”',
    );
    expect(taskOrReminderText({ source: 'task', action: 'completed', title: 'Ship' }, 'Ada')).toBe(
      'Ada completed “Ship”',
    );
    expect(taskOrReminderText({ source: 'task', action: 'due', title: 'Ship' })).toBe(
      'Task due: “Ship”',
    );
    expect(taskOrReminderText({ source: 'reminder', text: 'stand up' })).toBe(
      '⏰ Reminder: stand up',
    );
    expect(taskOrReminderText({ source: 'jira' })).toBeNull();
  });
});

// ---------- TasksPane rendering ----------

const tasksData: { current: TaskDto[] } = { current: [] };
const mutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useTasks: () => ({ data: tasksData.current, isLoading: false, isError: false, isSuccess: true }),
  useMembers: () => ({ data: [{ user: me }, { user: other }] }),
  useCreateTask: () => ({ mutate, isPending: false }),
  useUpdateTask: () => ({ mutate, isPending: false }),
  useDeleteTask: () => ({ mutate, isPending: false }),
  useWorkflowRequests: () => ({ data: [] }),
  useRespondToWorkflowRequest: () => ({ mutate, isPending: false }),
  useTaskJira: () => ({
    create: { mutate, isPending: false },
    link: { mutate, isPending: false },
    unlink: { mutate, isPending: false },
  }),
  useJiraProjects: () => ({ data: [] }),
}));
vi.mock('./atlassian-dialog', () => ({
  useAtlassianStatus: () => ({ data: { connected: false } }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: { user: typeof me }) => unknown) => sel({ user: me }),
}));

describe('TasksPane', () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it('splits tasks into mine / delegated / done and groups mine by due date', async () => {
    const { TasksPane } = await import('./tasks-pane');
    tasksData.current = [
      task({
        id: 'late',
        title: 'Late one',
        dueAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      task({ id: 'nodate', title: 'Someday one' }),
      task({ id: 'unassigned', title: 'Unassigned mine', assignee: null }),
      task({ id: 'handed', title: 'Handed off', assignee: other }),
      task({ id: 'theirs', title: 'From Bob', assignee: me, createdBy: other }),
      task({ id: 'fin', title: 'Finished', status: 'DONE', completedAt: new Date().toISOString() }),
    ];
    render(<TasksPane workspaceId="w1" onNavigate={() => undefined} />);

    expect(screen.getByText('Late one')).toBeTruthy();
    expect(screen.getByText(/Overdue · 1/)).toBeTruthy();
    expect(screen.getByText('Unassigned mine')).toBeTruthy();
    expect(screen.getByText('From Bob')).toBeTruthy();
    expect(screen.getByText('from Bob Stone')).toBeTruthy();
    expect(screen.queryByText('Handed off')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();

    fireEvent.click(screen.getByTestId('tasks-tab-delegated'));
    expect(screen.getByText('Handed off')).toBeTruthy();
    expect(screen.queryByText('Late one')).toBeNull();

    fireEvent.click(screen.getByTestId('tasks-tab-done'));
    expect(screen.getByText('Finished')).toBeTruthy();
  });

  it('toggling a task marks it done', async () => {
    const { TasksPane } = await import('./tasks-pane');
    tasksData.current = [task({ id: 't1', title: 'Do it' })];
    render(<TasksPane workspaceId="w1" onNavigate={() => undefined} />);
    fireEvent.click(screen.getByTestId('task-toggle-t1'));
    expect(mutate).toHaveBeenCalledWith({ id: 't1', status: 'DONE' }, expect.anything());
  });

  it('quick-add sends the title and trims it', async () => {
    const { TasksPane } = await import('./tasks-pane');
    tasksData.current = [];
    render(<TasksPane workspaceId="w1" onNavigate={() => undefined} />);
    fireEvent.change(screen.getByTestId('task-title-input'), {
      target: { value: '  Write tests  ' },
    });
    fireEvent.click(screen.getByTestId('task-add'));
    expect(mutate).toHaveBeenCalledWith(
      { title: 'Write tests', notes: '', dueAt: undefined },
      expect.anything(),
    );
  });
});
