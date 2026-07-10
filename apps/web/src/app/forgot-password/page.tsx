'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AuthCard, Field, FormError, SubmitButton } from '@/components/auth/auth-card';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('POST', '/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          If an account exists for <strong>{email}</strong>, a reset token has been sent. Use it on
          the <Link href="/reset-password" className="text-accent hover:underline">reset page</Link>.
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <FormError message={error} />
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <SubmitButton>Send reset link</SubmitButton>
        </form>
      )}
      <div className="mt-4 text-sm">
        <Link className="text-accent hover:underline" href="/login">
          Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
