import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MyDayDto, MyDayItemDto } from '@backstages/shared';

const item = (id: string, over: Partial<MyDayItemDto> = {}): MyDayItemDto => ({
  id,
  kind: 'task',
  title: id,
  detail: null,
  reason: 'No due date',
  overdue: false,
  due: null,
  url: null,
  ...over,
});

const day: { current: MyDayDto } = {
  current: {
    date: '2026-10-08',
    tzOffsetMin: 420,
    workHours: { startMin: 540, endMin: 1020 },
    outOfOffice: null,
    meetings: [
      {
        id: 'huddle:h1',
        title: 'Design sync',
        start: '2026-10-08T03:00:00Z',
        end: '2026-10-08T03:30:00Z',
        source: 'huddle',
        channelId: 'c1',
        conversationId: null,
      },
    ],
    focus: [
      item('request:r1', {
        kind: 'request',
        title: 'Approve the taxi?',
        reason: 'Someone is waiting on your approval',
      }),
      item('task:t1', { title: 'Late report', reason: 'Overdue', overdue: true }),
      item('jira:J-1', {
        kind: 'jira',
        title: 'J-1 · Fix login',
        reason: 'Assigned to you in Jira',
        url: 'https://x/browse/J-1',
      }),
    ],
    counts: { overdue: 1, dueToday: 0, requests: 1, jira: 1, meetings: 1 },
    jira: { state: 'ok' },
    calendar: { state: 'none' },
  },
};
const updateTask = vi.fn();
const plan = vi.fn();
const setMainView = vi.fn();
const navigate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useMyDay: () => ({ data: day.current, isLoading: false, isError: false }),
  useAiStatus: () => ({ data: { enabled: true } }),
  usePlanMyDay: () => ({ mutate: plan, isPending: false }),
  useUpdateTask: () => ({ mutate: updateTask }),
}));
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (sel: (s: object) => unknown) =>
    sel({ setMainView, pushToast: vi.fn(), toggleSidebar: vi.fn() }),
}));

describe('MyDayPane', () => {
  beforeEach(() => {
    updateTask.mockReset();
    plan.mockReset();
    setMainView.mockReset();
  });

  it('shows counts, the focus list in order, the schedule and setup hints', async () => {
    const { MyDayPane } = await import('./my-day-pane');
    render(<MyDayPane workspaceId="w1" onNavigate={navigate} />);
    const rows = screen.getAllByTestId(/^focus-/).map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['focus-request:r1', 'focus-task:t1', 'focus-jira:J-1']);
    expect(screen.getByText('Design sync')).toBeTruthy();
    expect(screen.getByText(/Link your calendar/)).toBeTruthy();
    // "Overdue" is both a count tile label and the late task's reason badge.
    expect(screen.getAllByText('Overdue')).toHaveLength(2);
    expect(screen.getByText('Someone is waiting on your approval')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Open Design sync'));
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', id: 'c1' });
  });

  it('completes a task, routes requests to Tasks, links Jira out', async () => {
    const { MyDayPane } = await import('./my-day-pane');
    render(<MyDayPane workspaceId="w1" onNavigate={navigate} />);
    fireEvent.click(screen.getByLabelText('Mark “Late report” as done'));
    expect(updateTask).toHaveBeenCalledWith({ id: 't1', status: 'DONE' }, expect.anything());
    fireEvent.click(screen.getByText('Respond'));
    expect(setMainView).toHaveBeenCalledWith('tasks');
    expect(screen.getByLabelText('Open J-1 · Fix login in Jira').getAttribute('href')).toBe(
      'https://x/browse/J-1',
    );
  });

  it('applies an AI-suggested order with its reasons, and can reset', async () => {
    const { MyDayPane } = await import('./my-day-pane');
    plan.mockImplementation((_v, opts: { onSuccess: (p: object) => void }) =>
      opts.onSuccess({
        aiUsed: true,
        focus: [
          { ...day.current.focus[2], reason: 'Unblocks the release' },
          day.current.focus[0],
          day.current.focus[1],
        ],
      }),
    );
    render(<MyDayPane workspaceId="w1" onNavigate={navigate} />);
    fireEvent.click(screen.getByTestId('plan-my-day'));
    const rows = screen.getAllByTestId(/^focus-/).map((el) => el.getAttribute('data-testid'));
    expect(rows[0]).toBe('focus-jira:J-1');
    expect(screen.getByText('Unblocks the release')).toBeTruthy();
    expect(screen.getByText('AI-suggested order')).toBeTruthy();
    fireEvent.click(screen.getByText('Standard order'));
    expect(screen.getAllByTestId(/^focus-/)[0].getAttribute('data-testid')).toBe(
      'focus-request:r1',
    );
  });
});
