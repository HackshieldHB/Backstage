'use client';

import type { AuthResponse } from '@backstages/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Envelope<T> {
  data: T;
  error: { code: number; message: string; details?: unknown } | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// ---- token storage (localStorage + memory mirror) ----

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') accessToken = window.localStorage.getItem('bs.accessToken');
  return accessToken;
}

export function getRefreshToken(): string | null {
  return typeof window !== 'undefined' ? window.localStorage.getItem('bs.refreshToken') : null;
}

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null) {
  accessToken = tokens?.accessToken ?? null;
  if (typeof window === 'undefined') return;
  if (tokens) {
    window.localStorage.setItem('bs.accessToken', tokens.accessToken);
    window.localStorage.setItem('bs.refreshToken', tokens.refreshToken);
  } else {
    window.localStorage.removeItem('bs.accessToken');
    window.localStorage.removeItem('bs.refreshToken');
  }
  window.dispatchEvent(new Event('bs:tokens-changed'));
}

// ---- refresh rotation (single-flight) ----

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const json = (await res.json()) as Envelope<AuthResponse>;
        if (!res.ok || json.error) return false;
        setTokens({ accessToken: json.data.accessToken, refreshToken: json.data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshPromise = null), 0);
      }
    })();
  }
  return refreshPromise;
}

// ---- request helper ----

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { retry?: boolean; formData?: FormData } = {},
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(opts.formData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(method, path, body, { ...opts, retry: false });
    setTokens(null);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return json.data;
}

/** Prefix relative attachment urls (they come as /attachments/...?sig=...) */
export function fileUrl(url: string): string {
  return url.startsWith('http') ? url : `${API_URL}${url}`;
}
