import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowInputSchema, type WorkflowDto } from '@backstages/shared';
import { describeAction, describeTrigger, toInput } from './workflows-dialog';

const channel = (id: string) => ({ c1: 'general', c2: 'ops' })[id] ?? 'unknown';
const person = (id: string) => ({ u1: 'Ada' })[id] ?? 'a member';

describe('describeTrigger / describeAction', () => {
  it('describes each trigger', () => {
    const d = (trigger: WorkflowDto['trigger'], config: object) =>
      describeTrigger({ trigger, config } as Pick<WorkflowDto, 'trigger' | 'config'>, channel);
    expect(d('message_posted', { channelId: 'c1', keyword: 'deploy', actions: [] })).toBe(
      'When a message containing “deploy” is posted in #general',
    );
    expect(d('reaction_added', { channelId: 'c2', emoji: 'ticket', actions: [] })).toBe(
      'When someone reacts :ticket: in #ops',
    );
    expect(d('member_joined', { channelId: 'c1', actions: [] })).toBe(
      'When someone joins #general',
    );
    expect(d('incident_declared', { minSeverity: 'SEV3', actions: [] })).toBe(
      'When any incident is declared',
    );
    expect(d('incident_declared', { minSeverity: 'SEV1', actions: [] })).toBe(
      'When a SEV1 or worse incident is declared',
    );
    expect(
      d('schedule', { days: [1, 2, 3, 4, 5], time: '09:00', timeZone: 'UTC', actions: [] }),
    ).toBe('Weekdays at 09:00 (UTC)');
    expect(
      d('schedule', { days: [0, 1, 2, 3, 4, 5, 6], time: '18:30', timeZone: 'UTC', actions: [] }),
    ).toBe('Every day at 18:30 (UTC)');
    expect(d('schedule', { days: [5, 1], time: '10:00', timeZone: 'UTC', actions: [] })).toBe(
      'Mon, Fri at 10:00 (UTC)',
    );
  });

  it('describes actions', () => {
    expect(
      describeAction({ type: 'post_message', channelId: 'c2', text: 'x' }, channel, person),
    ).toBe('post to #ops');
    expect(
      describeAction({ type: 'send_dm', to: 'trigger_user', text: 'x' }, channel, person),
    ).toBe('DM the person who triggered it');
    expect(
      describeAction({ type: 'create_task', title: 't', assignee: 'u1' }, channel, person),
    ).toBe('create a task for Ada');
  });
});

describe('toInput', () => {
  const base = {
    name: ' Nudge ',
    enabled: true,
    channelId: 'c1',
    keyword: '  ',
    emoji: ':ticket:',
    minSeverity: 'SEV3' as const,
    days: [5, 1],
    time: '09:00',
    timeZone: 'UTC',
    actions: [{ type: 'post_message' as const, channelId: 'c2', text: 'hi' }],
  };

  it('produces schema-valid bodies for every trigger', () => {
    for (const trigger of [
      'message_posted',
      'reaction_added',
      'member_joined',
      'incident_declared',
      'schedule',
    ] as const) {
      const body = toInput({ ...base, trigger });
      expect(WorkflowInputSchema.safeParse(body).success).toBe(true);
    }
  });

  it('trims the name, drops a blank keyword, strips emoji colons and sorts days', () => {
    expect(toInput({ ...base, trigger: 'message_posted' })).toEqual({
      name: 'Nudge',
      enabled: true,
      trigger: 'message_posted',
      config: { channelId: 'c1', actions: base.actions },
    });
    expect(
      (toInput({ ...base, trigger: 'reaction_added' }).config as { emoji: string }).emoji,
    ).toBe('ticket');
    expect((toInput({ ...base, trigger: 'schedule' }).config as { days: number[] }).days).toEqual([
      1, 5,
    ]);
  });
});

// ---------- dialog ----------

const apiMock = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('@/hooks/queries', () => ({
  keys: { workflows: (ws: string) => ['workflows', ws] },
  useMembers: () => ({ data: [{ user: { id: 'u1', displayName: 'Ada', avatarUrl: null } }] }),
  useWorkflows: () => ({
    isSuccess: true,
    data: [
      {
        id: 'wf1',
        name: 'Deploys',
        enabled: true,
        trigger: 'message_posted',
        config: {
          channelId: 'c1',
          actions: [{ type: 'post_message', channelId: 'c2', text: 'x' }],
        },
        runCount: 3,
        lastRunAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const channels = [
  { id: 'c1', name: 'general' },
  { id: 'c2', name: 'ops' },
] as never;

describe('WorkflowsDialog', () => {
  it('lists workflows with a readable summary and run stats', async () => {
    const { WorkflowsDialog } = await import('./workflows-dialog');
    render(
      <WorkflowsDialog workspaceId="w1" channels={channels} canManage onClose={() => undefined} />,
    );
    expect(screen.getByText('Deploys')).toBeTruthy();
    expect(screen.getByText(/When a message is posted in #general → post to #ops/)).toBeTruthy();
    expect(screen.getByText(/Ran 3 times/)).toBeTruthy();
  });

  it('hides management controls from non-admins', async () => {
    const { WorkflowsDialog } = await import('./workflows-dialog');
    render(
      <WorkflowsDialog
        workspaceId="w1"
        channels={channels}
        canManage={false}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByTestId('new-workflow')).toBeNull();
    expect(screen.queryByLabelText('Edit Deploys')).toBeNull();
  });

  it('builds and saves a multi-action workflow', async () => {
    apiMock.mockClear();
    const { WorkflowsDialog } = await import('./workflows-dialog');
    render(
      <WorkflowsDialog workspaceId="w1" channels={channels} canManage onClose={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('new-workflow'));
    fireEvent.change(screen.getByTestId('workflow-name'), { target: { value: 'Ticket triage' } });
    fireEvent.change(screen.getByTestId('workflow-trigger'), {
      target: { value: 'reaction_added' },
    });
    fireEvent.change(screen.getByLabelText('Action 1 type'), { target: { value: 'create_task' } });
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Triage {{message}}' },
    });
    fireEvent.click(screen.getByTestId('save-workflow'));

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('POST', '/workspaces/w1/workflows', {
      name: 'Ticket triage',
      enabled: true,
      trigger: 'reaction_added',
      config: {
        channelId: 'c1',
        emoji: 'ticket',
        actions: [{ type: 'create_task', title: 'Triage {{message}}', assignee: 'trigger_user' }],
      },
    });
  });
});
