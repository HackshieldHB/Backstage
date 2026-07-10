'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

export default function SignupPage() {
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field
          label="Full name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          autoFocus
          data-testid="signup-name"
        />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="signup-email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          data-testid="signup-password"
        />
        <SubmitButton disabled={busy}>{busy ? 'Creating…' : 'Create account'}</SubmitButton>
      </form>
      <div className="mt-4 text-sm">
        <Link className="text-accent hover:underline" href="/login">
          Already have an account? Sign in
        </Link>
      </div>
    </AuthCard>
  );
}
