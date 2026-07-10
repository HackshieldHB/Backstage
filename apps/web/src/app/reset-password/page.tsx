'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/auth/reset-password', { token, password });
      router.replace('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field label="Reset token" value={token} onChange={(e) => setToken(e.target.value)} required autoFocus />
        <Field
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <SubmitButton>Reset password</SubmitButton>
      </form>
      <div className="mt-4 text-sm">
        <Link className="text-accent hover:underline" href="/login">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
