import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TaskDto } from '@backstages/shared';

const create = vi.fn();
const link = vi.fn();
const unlink = vi.fn();
const status: { connected: boolean } = { connected: true };

vi.mock('@/hooks/queries', () => ({
  useTaskJira: () => ({
    create: { mutate: create, isPending: false },
    link: { mutate: link, isPending: false },
    unlink: { mutate: unlink, isPending: false },
  }),
  useJiraProjects: () => ({
    data: [{ id: '1', key: 'PROJ', name: 'Project One' }],
    isError: false,
  }),
}));
vi.mock('./atlassian-dialog', () => ({
  useAtlassianStatus: () => ({ data: { connected: status.connected } }),
}));

const base: TaskDto = {
  id: 't1',
  workspaceId: 'w1',
  title: 'Write docs',
  notes: '',
  status: 'OPEN',
  dueAt: null,
  assignee: null,
  createdBy: { id: 'u1', displayName: 'Ada', avatarUrl: null },
  messageId: null,
  channelId: null,
  conversationId: null,
  meetingRecordId: null,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
  jira: null,
  jiraSyncError: null,
};

describe('TaskJira', () => {
  beforeEach(() => {
    create.mockReset();
    link.mockReset();
    unlink.mockReset();
    status.connected = true;
  });

  it('shows the linked issue with its status, any sync error, and unlinks', async () => {
    const { TaskJira } = await import('./task-jira');
    render(
      <TaskJira
        workspaceId="w1"
        task={{
          ...base,
          jira: { key: 'PROJ-7', url: 'https://x/browse/PROJ-7', status: 'In Progress' },
          jiraSyncError: 'Connect your Atlassian account to update PROJ-7 in Jira',
        }}
      />,
    );
    const a = screen.getByText('PROJ-7').closest('a')!;
    expect(a.getAttribute('href')).toBe('https://x/browse/PROJ-7');
    expect(screen.getByText('· In Progress')).toBeTruthy();
    expect(screen.getByTestId('jira-sync-error').textContent).toMatch(
      /Connect your Atlassian account/,
    );
    fireEvent.click(screen.getByLabelText('Unlink PROJ-7'));
    expect(unlink).toHaveBeenCalledWith('t1', expect.anything());
  });

  it('offers nothing when the workspace is not connected to Jira', async () => {
    status.connected = false;
    const { TaskJira } = await import('./task-jira');
    const { container } = render(<TaskJira workspaceId="w1" task={base} />);
    expect(container.innerHTML).toBe('');
  });

  it('creates an issue in the chosen project, or links one by key', async () => {
    const { TaskJira } = await import('./task-jira');
    render(<TaskJira workspaceId="w1" task={base} />);
    fireEvent.click(screen.getByText('Jira'));
    fireEvent.click(screen.getByText('Create issue'));
    expect(create).toHaveBeenCalledWith({ id: 't1', projectKey: 'PROJ' }, expect.anything());

    fireEvent.click(screen.getByText('Link an existing issue'));
    fireEvent.change(screen.getByPlaceholderText('PROJ-123'), { target: { value: ' ops-9 ' } });
    fireEvent.click(screen.getByText('Link issue'));
    expect(link).toHaveBeenCalledWith({ id: 't1', issueKey: 'ops-9' }, expect.anything());
  });
});
