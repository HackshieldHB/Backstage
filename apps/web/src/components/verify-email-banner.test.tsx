import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));
const pushToast = vi.fn();
vi.mock('@/stores/ui-store', () => ({
  useUiStore: (sel: (s: { pushToast: typeof pushToast }) => unknown) => sel({ pushToast }),
}));
const auth: { user: { email: string; emailVerified?: boolean } | null } = { user: null };
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: (s: typeof auth) => unknown) => sel(auth),
}));

afterEach(cleanup);

describe('VerifyEmailBanner', () => {
  beforeEach(() => {
    apiMock.mockReset();
    pushToast.mockReset();
  });

  it('shows only for unverified people and resends the link', async () => {
    const { VerifyEmailBanner } = await import('./verify-email-banner');
    auth.user = { email: 'ada@example.com', emailVerified: true };
    const { rerender } = render(<VerifyEmailBanner />);
    expect(screen.queryByTestId('verify-email-banner')).toBeNull();

    // Older API responses without the flag: don't nag.
    auth.user = { email: 'ada@example.com' };
    rerender(<VerifyEmailBanner />);
    expect(screen.queryByTestId('verify-email-banner')).toBeNull();

    auth.user = { email: 'ada@example.com', emailVerified: false };
    rerender(<VerifyEmailBanner />);
    expect(screen.getByTestId('verify-email-banner').textContent).toContain('ada@example.com');
    apiMock.mockResolvedValue({ sent: true });
    fireEvent.click(screen.getByText('Resend'));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('We sent a new link to ada@example.com.', 'success'));
    expect(apiMock).toHaveBeenCalledWith('POST', '/auth/verify-email/send');

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('verify-email-banner')).toBeNull();
  });
});
