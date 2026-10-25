'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import type { SsoDiscoveryDto } from '@backstages/shared';
import { api, API_URL } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, Field, FormError, SubmitButton, altButton } from '@/components/auth/auth-card';
import { OrDivider, SocialButtons } from '@/components/auth/social-buttons';
import { MFA_HANDOFF_KEY } from '@/lib/auth-handoff';

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
  'oauth-denied': 'Sign-in was cancelled. You can try again or use email & password.',
  'oauth-expired': 'That sign-in took too long. Please try again.',
  'oauth-state': 'That sign-in link is not valid. Please start again from this page.',
  'oauth-browser':
    'That sign-in was started in a different browser or tab session. For your safety, please start it again here.',
  'oauth-no-verified-email':
    "Your account there doesn't have a verified email address we can use. Verify your email with the provider (for GitHub: a verified, non-private address), or sign up with email & password.",
  'oauth-unverified-account':
    "An account with this email already exists but its email was never confirmed. Sign in with your password (or use “Forgot password?”) first — then you can connect Google or GitHub from Account security.",
  'oauth-sso-required': "Your organization requires single sign-on. Use “Continue with SSO” with your work email.",
  'oauth-not-configured': 'That sign-in option is not set up on this server.',
  'oauth-provider': "We couldn't complete sign-in with the provider. Please try again in a moment.",
  'oauth-failed': 'Sign-in failed. Please try again in a moment, or use email & password.',
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
    // A social sign-in for an account with 2FA on continues here.
    try {
      const handoff = window.sessionStorage.getItem(MFA_HANDOFF_KEY);
      if (handoff) {
        window.sessionStorage.removeItem(MFA_HANDOFF_KEY);
        setMfaToken(handoff);
      }
    } catch {
      /* storage unavailable: the person signs in again */
    }
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
          <p className="mb-4 text-sm text-ink-2">
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
          <SubmitButton busy={busy} disabled={code.trim().length < 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </SubmitButton>
        </form>
        <div className="mt-5 flex justify-between text-sm">
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode('');
            }}
          >
            {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
          </button>
          <button
            type="button"
            className="font-medium text-accent hover:underline"
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
    <AuthCard title="Welcome back" subtitle="Sign in to pick up where your team left off.">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field
          label="Email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
          data-testid="login-email"
        />
        <Field
          label="Password"
          type="password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          data-testid="login-password"
        />
        <div className="-mt-1.5 mb-4 flex justify-end">
          <Link className="text-[13px] font-medium text-accent hover:underline" href="/forgot-password">
            Forgot password?
          </Link>
        </div>
        <SubmitButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
      <OrDivider label="or continue with" />
      <div className="space-y-2">
        <SocialButtons />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void continueWithSso()}
            disabled={ssoBusy}
            className={altButton}
            aria-label="Continue with SSO"
            data-testid="login-sso"
          >
            {ssoBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
            {ssoBusy ? 'Redirecting…' : 'SSO'}
          </button>
          <a href={`${API_URL}/auth/atlassian`} className={altButton} aria-label="Log in with Atlassian">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#2684FF]" aria-hidden>
              <path d="M7.12 11.08a.68.68 0 0 0-1.16.13L.55 21.99a.7.7 0 0 0 .63 1.01h7.52a.67.67 0 0 0 .63-.39c1.63-3.37.64-8.49-2.21-11.53zM11.44.36a15.4 15.4 0 0 0-.9 15.23l3.63 7.02a.7.7 0 0 0 .62.38h7.53a.7.7 0 0 0 .63-1.01L12.6.37a.65.65 0 0 0-1.16-.01z" />
            </svg>
            Atlassian
          </a>
        </div>
      </div>
      <p className="mt-7 text-center text-sm text-ink-2">
        New to Backstages?{' '}
        <Link className="font-semibold text-accent hover:underline" href="/signup">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
