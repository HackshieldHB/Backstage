import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  API_URL: 'http://api.test',
  setTokens: vi.fn(),
  getAccessToken: () => null,
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

describe('AccountSecurityDialog', () => {
  beforeEach(() => {
    apiMock.mockReset();
    pushToast.mockReset();
  });

  it('sets up 2FA: shows the key, confirms a code, then shows recovery codes once', async () => {
    let enabled = false;
    apiMock.mockImplementation(async (method: string, path: string) => {
      if (path === '/auth/2fa') return { enabled, recoveryCodesLeft: enabled ? 10 : 0 };
      if (path === '/me/api-tokens') return [];
      if (path === '/auth/2fa/setup') return { secret: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP' };
      if (path === '/auth/2fa/enable') {
        enabled = true;
        return { recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const { AccountSecurityDialog } = await import('./account-security');
    wrap(<AccountSecurityDialog onClose={() => undefined} />);

    expect((await screen.findByTestId('tfa-status')).textContent).toContain('Off');
    fireEvent.click(screen.getByTestId('tfa-start'));
    expect((await screen.findByTestId('tfa-secret')).textContent).toContain('ABCD EFGH IJKL MNOP');
    expect(((screen.getByTestId('tfa-enable')) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('tfa-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('tfa-enable'));

    expect((await screen.findByTestId('one-time-secret')).textContent).toContain('aaaaa-bbbbb');
    expect(apiMock).toHaveBeenCalledWith('POST', '/auth/2fa/enable', { code: '123456' });
    await waitFor(() => expect((screen.getByTestId('tfa-status')).textContent).toContain('On'));
  });

  it('creates an API token and shows it once', async () => {
    apiMock.mockImplementation(async (method: string, path: string, body?: { name: string; scope: string }) => {
      if (path === '/auth/2fa') return { enabled: false, recoveryCodesLeft: 0 };
      if (path === '/me/api-tokens' && method === 'GET') return [];
      if (path === '/me/api-tokens' && method === 'POST') {
        return {
          id: 't1',
          name: body!.name,
          prefix: 'bs_pat_abcd',
          scope: body!.scope,
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
          token: 'bs_pat_abcdSECRET',
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const { AccountSecurityDialog } = await import('./account-security');
    wrap(<AccountSecurityDialog onClose={() => undefined} />);

    const name = await screen.findByTestId('token-name');
    expect(((screen.getByTestId('token-create')) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'CI' } });
    fireEvent.click(screen.getByTestId('token-create'));
    expect((await screen.findByTestId('one-time-secret')).textContent).toContain('bs_pat_abcdSECRET');
    expect(apiMock).toHaveBeenCalledWith('POST', '/me/api-tokens', { name: 'CI', scope: 'read', expiresInDays: 90 });
  });
});

describe('WorkspaceSecuritySettings', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('shows DNS instructions for pending domains and hides owner controls from admins', async () => {
    apiMock.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith('/domains')) {
        return [
          {
            id: 'd1',
            domain: 'acme.com',
            verified: false,
            verifiedAt: null,
            txtRecordName: '_backstages-challenge.acme.com',
            txtRecordValue: 'backstages-verification=abc',
          },
        ];
      }
      if (path.endsWith('/sso')) return null;
      if (path.endsWith('/scim')) return { enabled: false, tokenPrefix: null, baseUrl: 'http://api.test/scim/v2' };
      if (path.endsWith('/bots')) return [];
      if (path.endsWith('/retention')) return { retentionDays: null, legalHold: false };
      throw new Error(`unexpected ${path}`);
    });
    const { WorkspaceSecuritySettings } = await import('./workspace-security');
    wrap(<WorkspaceSecuritySettings workspaceId="w1" isOwner={false} />);

    expect(await screen.findByText('_backstages-challenge.acme.com')).toBeTruthy();
    expect(screen.getByText('backstages-verification=abc')).toBeTruthy();
    expect(screen.getByText(/Only the workspace owner can change/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Enable SCIM/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export everything/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Export public channels/ })).toBeTruthy();
    // Admins can still manage bots.
    expect(screen.getByRole('button', { name: 'Create bot' })).toBeTruthy();
  });
});
