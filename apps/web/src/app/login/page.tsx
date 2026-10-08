'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import type { SsoDiscoveryDto } from '@backstages/shared';
import { api, API_URL } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

/** Friendly copy for the ?error= codes the Atlassian and SSO callbacks bounce back with. */
const LOGIN_ERRORS: Record<string, string> = {
  'atlassian-email-unverified':
    "Your Atlassian account doesn't expose a verified email, so we can't sign you in that way. Create an account with email & password below, or make your Atlassian email public and verified, then try again.",
  'atlassian-denied': 'Atlassian sign-in was cancelled. You can try again or use email & password.',
  'atlassian-failed': 'Atlassian sign-in failed. Please try again in a moment, or use email & password.',
  'sso-denied': 'Single sign-on was cancelled. You can try again.',
  'sso-expired': 'That sign-in link expired. Please try again.',
  'sso-domain':
    "Your email's domain isn't verified for this workspace's single sign-on yet. Ask a workspace admin to verify it.",
  'sso-unverified': "Your identity provider reports this email as unverified, so we can't sign you in with it.",
  'sso-no-email': 'Your identity provider did not share an email address with Backstages.',
  'sso-deactivated': 'Your account in this workspace has been deactivated. Contact a workspace admin.',
  'sso-not-configured': 'Single sign-on is not set up for this workspace.',
};

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const loginTwoFactor = useAuthStore((s) => s.loginTwoFactor);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the password is accepted for an account with 2FA on. */
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

  // Surface an Atlassian / SSO failure the callback redirected us back with.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(LOGIN_ERRORS[code] ?? 'Sign-in failed. Please try again.');
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const challenge = await login(email, password);
      if (challenge) {
        setMfaToken(challenge.mfaToken);
        setBusy(false);
        return;
      }
      router.replace('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  };

  const onSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      await loginTwoFactor(mfaToken, code);
      router.replace('/app');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That code is not valid';
      setError(message);
      setBusy(false);
      // The challenge is spent after too many tries — back to the password step.
      if (/password again|expired/i.test(message)) {
        setMfaToken(null);
        setCode('');
      }
    }
  };

  /** "Continue with SSO": look up the email's workspace IdP and go there. */
  const continueWithSso = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter your work email first, then choose Continue with SSO.');
      return;
    }
    setSsoBusy(true);
    setError(null);
    try {
      const found = await api<SsoDiscoveryDto>('GET', `/auth/sso/discover?email=${encodeURIComponent(value)}`, undefined, {
        retry: false,
      });
      if (!found.sso || !found.workspaceId) {
        setError("Single sign-on isn't set up for that email's domain. Sign in with your password instead.");
        setSsoBusy(false);
        return;
      }
      const params = new URLSearchParams({ workspaceId: found.workspaceId, email: value });
      window.location.href = `${API_URL}/auth/sso/start?${params.toString()}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start single sign-on');
      setSsoBusy(false);
    }
  };

  if (mfaToken) {
    return (
      <AuthCard title="Two-factor authentication">
        <form onSubmit={onSubmitCode}>
          <FormError message={error} />
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
            {useRecovery
              ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
          <Field
            label={useRecovery ? 'Recovery code' : 'Authentication code'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            data-testid="login-2fa-code"
          />
          <SubmitButton disabled={busy || code.trim().length < 6}>{busy ? 'Verifying…' : 'Verify'}</SubmitButton>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode('');
            }}
          >
            {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
          </button>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              setMfaToken(null);
              setCode('');
              setError(null);
            }}
          >
            Back
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          data-testid="login-email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          data-testid="login-password"
        />
        <SubmitButton disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>
      <button
        type="button"
        onClick={() => void continueWithSso()}
        disabled={ssoBusy}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-line-strong dark:hover:bg-gray-800"
        data-testid="login-sso"
      >
        <KeyRound size={16} aria-hidden />
        {ssoBusy ? 'Redirecting…' : 'Continue with SSO'}
      </button>
      <a
        href={`${API_URL}/auth/atlassian`}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#2684FF]" aria-hidden>
          <path d="M7.12 11.08a.68.68 0 0 0-1.16.13L.55 21.99a.7.7 0 0 0 .63 1.01h7.52a.67.67 0 0 0 .63-.39c1.63-3.37.64-8.49-2.21-11.53zM11.44.36a15.4 15.4 0 0 0-.9 15.23l3.63 7.02a.7.7 0 0 0 .62.38h7.53a.7.7 0 0 0 .63-1.01L12.6.37a.65.65 0 0 0-1.16-.01z" />
        </svg>
        Log in with Atlassian
      </a>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-accent hover:underline" href="/signup">
          Create account
        </Link>
        <Link className="text-accent hover:underline" href="/forgot-password">
          Forgot password?
        </Link>
      </div>
    </AuthCard>
  );
}
