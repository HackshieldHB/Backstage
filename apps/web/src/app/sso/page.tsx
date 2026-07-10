'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setTokens } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

/** Landing page for the Atlassian SSO redirect: /sso#access=...&refresh=... */
export default function SsoPage() {
  const router = useRouter();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const access = fragment.get('access');
    const refresh = fragment.get('refresh');
    if (access && refresh) {
      setTokens({ accessToken: access, refreshToken: refresh });
      void bootstrap().then(() => router.replace('/app'));
    } else {
      router.replace('/login');
    }
  }, [router, bootstrap]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="animate-pulse text-lg font-semibold text-sidebar dark:text-white">
        Signing you in with Atlassian…
      </div>
    </main>
  );
}
