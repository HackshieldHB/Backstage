'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
