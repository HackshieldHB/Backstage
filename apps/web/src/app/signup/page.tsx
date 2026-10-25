'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { UserRound } from 'lucide-react';
import { AuthCard, Field, FormError, PasswordStrength, SubmitButton } from '@/components/auth/auth-card';
import { OrDivider, SocialButtons, useOAuthProviders } from '@/components/auth/social-buttons';

export default function SignupPage() {
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useOAuthProviders();
  const hasSocial = !!providers && (providers.google || providers.github);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(email, password, displayName);
      router.replace('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Join the crew" subtitle="Create your Backstages account. It takes less than a minute.">
      {hasSocial && (
        <>
          <SocialButtons verb="Sign up" />
          <OrDivider label="or sign up with email" />
        </>
      )}
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field
          label="Full name"
          icon={UserRound}
          placeholder="Ada Lovelace"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          autoFocus
          autoComplete="name"
          data-testid="signup-name"
        />
        <Field
          label="Email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          data-testid="signup-email"
        />
        <Field
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
          hint={<PasswordStrength password={password} />}
          data-testid="signup-password"
        />
        <SubmitButton busy={busy}>{busy ? 'Creating…' : 'Create account'}</SubmitButton>
      </form>
      <p className="mt-7 text-center text-sm text-ink-2">
        Already have an account?{' '}
        <Link className="font-semibold text-accent hover:underline" href="/login">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
