import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MessageDto } from '@backstages/shared';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BookmarksBar', () => {
  beforeEach(() => apiMock.mockReset());

  it('lists bookmarks as links and removes one', async () => {
    apiMock.mockImplementation(async (method: string) =>
      method === 'GET'
        ? [
            {
              id: 'b1',
              channelId: 'c1',
              title: 'Runbook',
              url: 'https://wiki.example.com/runbook',
              createdBy: { id: 'me', displayName: 'Me' },
              createdAt: '',
            },
          ]
        : { ok: true },
    );
    const { BookmarksBar } = await import('./bookmarks-bar');
    wrap(<BookmarksBar channelId="c1" />);
    const link = (await screen.findByText('Runbook')).closest('a')!;
    expect(link.getAttribute('href')).toBe('https://wiki.example.com/runbook');
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByLabelText('Remove bookmark Runbook'));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('DELETE', '/bookmarks/b1'));
  });

  it('refuses non-http links before calling the API', async () => {
    apiMock.mockImplementation(async () => []);
    const { BookmarksBar } = await import('./bookmarks-bar');
    wrap(<BookmarksBar channelId="c1" />);
    fireEvent.click(await screen.findByTestId('add-bookmark'));
    fireEvent.change(screen.getByDisplayValue('https://'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Runbook'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Add'));
    expect(apiMock).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());

    fireEvent.change(screen.getByDisplayValue('javascript:alert(1)'), {
      target: { value: 'https://docs.example.com' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('POST', '/channels/c1/bookmarks', {
        title: 'x',
        url: 'https://docs.example.com',
      }),
    );
  });
});

describe('MoveToSectionMenu', () => {
  beforeEach(() => apiMock.mockReset());

  it('files a channel into a section and back out', async () => {
    apiMock.mockResolvedValue({});
    const { MoveToSectionMenu } = await import('./sidebar-sections');
    wrap(
      <MoveToSectionMenu
        workspaceId="w1"
        kind="channel"
        id="c1"
        currentSectionId="s1"
        sections={[
          { id: 's1', name: 'Projects', position: 0 },
          { id: 's2', name: 'Friends', position: 1 },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move to section'));
    expect((screen.getByText('Projects') as HTMLButtonElement).disabled).toBe(true); // already there
    fireEvent.click(screen.getByText('Friends'));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('PUT', '/channels/c1/section', { sectionId: 's2' }),
    );
    fireEvent.click(screen.getByLabelText('Move to section'));
    fireEvent.click(screen.getByText('Remove from section'));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('PUT', '/channels/c1/section', { sectionId: null }),
    );
  });
});

describe('EditHistoryDialog', () => {
  beforeEach(() => apiMock.mockReset());

  it('shows the current text, then earlier versions with the original last', async () => {
    apiMock.mockResolvedValue([
      { contentText: 'second', contentJson: null, versionAt: '2026-10-08T02:00:00Z', replacedAt: '2026-10-08T03:00:00Z' },
      { contentText: 'first', contentJson: null, versionAt: '2026-10-08T01:00:00Z', replacedAt: '2026-10-08T02:00:00Z' },
    ]);
    const { EditHistoryDialog } = await import('./edit-history-dialog');
    const message = {
      id: 'm1',
      contentText: 'third',
      contentJson: null,
      editedAt: '2026-10-08T03:00:00Z',
    } as unknown as MessageDto;
    wrap(<EditHistoryDialog message={message} onClose={() => undefined} />);
    await screen.findByText('first');
    const text = screen.getByTestId('edit-history').textContent ?? '';
    expect(text.indexOf('third')).toBeLessThan(text.indexOf('second'));
    expect(text.indexOf('second')).toBeLessThan(text.indexOf('first'));
    expect(text).toMatch(/Original/);
    expect(apiMock).toHaveBeenCalledWith('GET', '/messages/m1/edits');
  });
});
