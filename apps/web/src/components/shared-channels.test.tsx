import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  API_URL: 'http://api.test',
}));
const pushToast = vi.fn();
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (sel: (s: { pushToast: typeof pushToast }) => unknown) => sel({ pushToast }),
}));

afterEach(cleanup);

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
  );

const channel = (over: Record<string, unknown>) => ({
  workspaceId: 'w1',
  topic: null,
  description: null,
  isPrivate: false,
  isArchived: false,
  isDefault: false,
  ...over,
});

describe('SharedChannelsSettings', () => {
  beforeEach(() => {
    apiMock.mockReset();
    pushToast.mockReset();
  });

  it('lets members join channels shared into the workspace, and hides admin tools from them', async () => {
    let joined = false;
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path === '/workspaces/w1/shared-channels') {
        return [
          {
            shareId: 's1',
            channelId: 'c9',
            name: 'launch',
            topic: null,
            host: { workspaceId: 'w2', name: 'Acme' },
            isMember: joined,
            isArchived: false,
          },
        ];
      }
      if (path === '/shared-channels/s1/join' && method === 'POST') {
        joined = true;
        return {};
      }
      if (path === '/workspaces/w1/channels') return [];
      throw new Error(`unexpected ${method} ${path}`);
    });
    const { SharedChannelsSettings } = await import('./shared-channels-settings');
    wrap(<SharedChannelsSettings workspaceId="w1" isAdmin={false} />);

    expect(await screen.findByText('from Acme')).toBeTruthy();
    expect(screen.queryByText('Accept an invite')).toBeNull();
    expect(screen.queryByText('Share a channel')).toBeNull();
    fireEvent.click(screen.getByTestId('join-shared-launch'));
    await waitFor(() => expect(screen.getByText('Joined')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('POST', '/shared-channels/s1/join');
  });

  it('admins share only public, non-default channels of their own workspace and see the invite once', async () => {
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path === '/workspaces/w1/shared-channels') return [];
      if (path === '/workspaces/w1/channels') {
        return [
          channel({ id: 'c1', name: 'general', isDefault: true }),
          channel({ id: 'c2', name: 'secret', isPrivate: true }),
          channel({ id: 'c3', name: 'partners' }),
          channel({ id: 'c4', name: 'their-channel', workspaceId: 'w2', sharedFrom: { workspaceId: 'w2', name: 'Acme' } }),
        ];
      }
      if (path === '/channels/c3/shares' && method === 'GET') return [];
      if (path === '/channels/c3/shares' && method === 'POST') {
        return {
          id: 's1',
          status: 'pending',
          partner: null,
          inviteExpiresAt: new Date().toISOString(),
          acceptedAt: null,
          createdAt: new Date().toISOString(),
          token: 'bs_share_abc123',
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const { SharedChannelsSettings } = await import('./shared-channels-settings');
    wrap(<SharedChannelsSettings workspaceId="w1" isAdmin />);

    const select = (await screen.findByLabelText('Channel to share')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['#partners']);
    fireEvent.click(screen.getByTestId('create-share-invite'));
    expect((await screen.findByTestId('one-time-secret')).textContent).toContain('bs_share_abc123');
    expect(screen.getByText('Accept an invite')).toBeTruthy();
  });
});
