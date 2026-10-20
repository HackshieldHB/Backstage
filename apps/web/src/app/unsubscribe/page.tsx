'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AuthCard } from '@/components/auth/auth-card';

/**
 * One-click "turn these emails off" from a missed-activity email:
 * /unsubscribe#token=… (the token stays in the fragment, so it never reaches a server log).
 */
export default function UnsubscribePage() {
  const [state, setState] = useState<'working' | 'done' | 'invalid'>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', '/unsubscribe');
    if (!token) {
      setState('invalid');
      return;
    }
    api('POST', '/email/unsubscribe', { token }, { retry: false })
      .then(() => setState('done'))
      .catch(() => setState('invalid'));
  }, []);

  return (
    <AuthCard title="Email preferences">
      {state === 'working' && <p className="text-sm text-gray-600 dark:text-gray-300">Updating your preferences…</p>}
      {state === 'done' && (
        <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="unsubscribed">
          Done — we won&apos;t email you about missed activity anymore. You can turn it back on anytime under your
          profile → “Emails when I&apos;m away”.
        </p>
      )}
      {state === 'invalid' && (
        <p className="text-sm text-red-600">
          This link isn&apos;t valid anymore. Sign in and change it under your profile → “Emails when I&apos;m away”.
        </p>
      )}
      <div className="mt-4 text-sm">
        <Link className="text-accent hover:underline" href="/app">
          Open Backstages
        </Link>
      </div>
    </AuthCard>
  );
}
