'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard } from '@/components/auth/auth-card';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user, loading } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (loading || attempted.current) return;
    if (!user) {
      // Come back here after login/signup.
      window.localStorage.setItem('bs.pendingInvite', token);
      router.replace('/signup');
      return;
    }
    attempted.current = true;
    api<{ id: string }>('POST', '/invites/accept', { token })
      .then((ws) => router.replace(`/app?ws=${ws.id}`))
      .catch((err) => setError(err instanceof Error ? err.message : 'Invite failed'));
  }, [user, loading, token, router]);

  return (
    <AuthCard title="Joining workspace…">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-300">Accepting your invite…</p>
      )}
    </AuthCard>
  );
}
