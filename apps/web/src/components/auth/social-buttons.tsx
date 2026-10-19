'use client';

import { useEffect, useState } from 'react';
import type { OAuthProvidersDto } from '@backstages/shared';
import { api, API_URL } from '@/lib/api';

export function GoogleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.9 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GithubIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`${className} fill-current`} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const btn =
  'flex w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800';

/** Which providers the server has configured (cached for the page's lifetime). */
let cached: OAuthProvidersDto | null = null;
export function useOAuthProviders(): OAuthProvidersDto | null {
  const [providers, setProviders] = useState<OAuthProvidersDto | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    api<OAuthProvidersDto>('GET', '/auth/oauth/providers', undefined, { retry: false })
      .then((p) => {
        cached = p;
        if (alive) setProviders(p);
      })
      .catch(() => alive && setProviders({ google: false, github: false }));
    return () => {
      alive = false;
    };
  }, []);
  return providers;
}

/**
 * "Continue with Google / GitHub". Full-page navigations to the API, which
 * sets a browser-binding cookie and redirects to the provider. Renders nothing
 * for providers the server hasn't configured.
 */
export function SocialButtons({ verb = 'Continue' }: { verb?: string }) {
  const providers = useOAuthProviders();
  if (!providers || (!providers.google && !providers.github)) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="social-buttons">
      {providers.google && (
        <a href={`${API_URL}/auth/oauth/google/start`} className={btn} data-testid="oauth-google">
          <GoogleIcon /> {verb} with Google
        </a>
      )}
      {providers.github && (
        <a href={`${API_URL}/auth/oauth/github/start`} className={btn} data-testid="oauth-github">
          <GithubIcon /> {verb} with GitHub
        </a>
      )}
    </div>
  );
}

/** "or" divider used between the social buttons and the email form. */
export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
    </div>
  );
}
