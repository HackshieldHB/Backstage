'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthResponse, MfaChallengeDto } from '@backstages/shared';
import { api, setTokens } from '@/lib/api';
import { MFA_HANDOFF_KEY } from '@/lib/auth-handoff';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Landing page after an external sign-in.
 *  - Google / GitHub / Atlassian: /sso#code=…  — a one-time code we trade for a
 *    session (or a 2FA challenge, finished on /login).
 *  - Workspace OIDC SSO: /sso#access=…&refresh=…
 * The fragment never reaches a server, and is dropped from history right away.
 */
export default function SsoPage() {
  const router = useRouter();
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev; the code is single-use.
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, '', '/sso');

    const code = fragment.get('code');
    const access = fragment.get('access');
    const refresh = fragment.get('refresh');

    if (code) {
      api<AuthResponse | MfaChallengeDto>('POST', '/auth/oauth/exchange', { code }, { retry: false })
        .then(async (res) => {
          if ('mfaRequired' in res) {
            try {
              window.sessionStorage.setItem(MFA_HANDOFF_KEY, res.mfaToken);
            } catch {
              /* without storage the person just signs in again */
            }
            router.replace('/login');
            return;
          }
          setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
          await bootstrap();
          router.replace('/app');
        })
        .catch(() => router.replace('/login?error=oauth-expired'));
      return;
    }
    if (access && refresh) {
      setTokens({ accessToken: access, refreshToken: refresh });
      void bootstrap().then(() => router.replace('/app'));
      return;
    }
    router.replace('/login');
  }, [router, bootstrap]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="animate-pulse text-lg font-semibold text-sidebar dark:text-white">Signing you in…</div>
    </main>
  );
}
