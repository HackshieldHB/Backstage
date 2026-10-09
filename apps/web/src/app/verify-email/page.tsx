'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { UserDto } from '@backstages/shared';
import { api, getAccessToken } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard, FormError } from '@/components/auth/auth-card';

/** Landing page for the verification link: /verify-email#token=... */
export default function VerifyEmailPage() {
  const setUser = useAuthStore((s) => s.setUser);
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the token is single-purpose; don't post it twice in dev StrictMode
    ran.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Drop the token from the address bar / history.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('This link is incomplete — open the link from your email again.');
      setState('error');
      return;
    }
    api<UserDto>('POST', '/auth/verify-email', { token }, { retry: false })
      .then((user) => {
        // Refresh the signed-in user (if this browser is signed in as them).
        if (getAccessToken() && useAuthStore.getState().user?.id === user.id) setUser(user);
        setState('done');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'This verification link is invalid or has expired');
        setState('error');
      });
  }, [setUser]);

  return (
    <AuthCard title="Confirm your email">
      {state === 'working' && <p className="text-sm text-gray-600 dark:text-gray-300">Confirming…</p>}
      {state === 'done' && (
        <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="verify-email-done">
          Thanks — your email address is confirmed.
        </p>
      )}
      {state === 'error' && <FormError message={error} />}
      <div className="mt-4 text-sm">
        <Link className="text-accent hover:underline" href="/app">
          Continue to Backstages
        </Link>
      </div>
    </AuthCard>
  );
}
