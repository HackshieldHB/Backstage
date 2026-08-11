'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

/** Friendly copy for the ?error= codes the Atlassian callback bounces back with. */
const ATLASSIAN_ERRORS: Record<string, string> = {
  'atlassian-email-unverified':
    "Your Atlassian account doesn't expose a verified email, so we can't sign you in that way. Create an account with email & password below, or make your Atlassian email public and verified, then try again.",
  'atlassian-denied': 'Atlassian sign-in was cancelled. You can try again or use email & password.',
  'atlassian-failed': 'Atlassian sign-in failed. Please try again in a moment, or use email & password.',
};

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface an Atlassian SSO failure the callback redirected us back with.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(ATLASSIAN_ERRORS[code] ?? 'Sign-in failed. Please try again.');
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  };

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
      <a
        href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/atlassian`}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
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
