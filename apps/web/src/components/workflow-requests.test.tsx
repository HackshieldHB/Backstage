import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkflowRequestDto } from '@backstages/shared';

const requests: { current: WorkflowRequestDto[] } = { current: [] };
const mutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useWorkflowRequests: () => ({ data: requests.current }),
  useRespondToWorkflowRequest: () => ({ mutate, isPending: false }),
}));

const base = {
  workflowName: 'Expense approval',
  requestedBy: { id: 'u1', displayName: 'Ada' },
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('WorkflowRequests', () => {
  beforeEach(() => mutate.mockReset());

  it('renders nothing when there are no requests', async () => {
    const { WorkflowRequests } = await import('./workflow-requests');
    requests.current = [];
    const { container } = render(<WorkflowRequests workspaceId="w1" />);
    expect(container.innerHTML).toBe('');
  });

  it('approves and rejects', async () => {
    const { WorkflowRequests } = await import('./workflow-requests');
    requests.current = [
      { ...base, runId: 'r1', kind: 'request_approval', prompt: 'Approve the taxi?', fields: [] },
    ];
    render(<WorkflowRequests workspaceId="w1" />);
    expect(screen.getByText('Approve the taxi?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('request-approve'));
    expect(mutate).toHaveBeenCalledWith({ runId: 'r1', decision: 'approve' }, expect.anything());
    fireEvent.click(screen.getByTestId('request-reject'));
    expect(mutate).toHaveBeenCalledWith({ runId: 'r1', decision: 'reject' }, expect.anything());
  });

  it('only submits a form once required fields are filled', async () => {
    const { WorkflowRequests } = await import('./workflow-requests');
    requests.current = [
      {
        ...base,
        runId: 'r2',
        kind: 'ask_form',
        prompt: 'Tell us about you',
        fields: [
          {
            key: 'team',
            label: 'Team',
            kind: 'select',
            options: ['eng', 'design'],
            required: true,
          },
          { key: 'goal', label: 'Goal', kind: 'text', required: false },
        ],
      },
    ];
    render(<WorkflowRequests workspaceId="w1" />);
    const submit = screen.getByTestId('request-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Team/), { target: { value: 'eng' } });
    fireEvent.change(screen.getByLabelText(/Goal/), { target: { value: 'ship' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(mutate).toHaveBeenCalledWith(
      { runId: 'r2', answers: { team: 'eng', goal: 'ship' } },
      expect.anything(),
    );
  });
});
