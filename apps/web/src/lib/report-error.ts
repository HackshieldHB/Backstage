import { API_URL } from './api';

/**
 * Best-effort ship a client-side crash to the API's `/client-errors` sink so it
 * lands in the same reporter (Sentry/log) the backend uses. Never throws and
 * never blocks rendering — a failure to report must not itself break the app.
 */
export function reportClientError(error: unknown, info?: { componentStack?: string }): void {
  try {
    const payload = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      componentStack: info?.componentStack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    };
    void fetch(`${API_URL}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* reporting is best-effort */
  }
}
