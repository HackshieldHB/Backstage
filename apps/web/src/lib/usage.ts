import { USAGE_EVENT_NAME } from '@backstages/shared';
import { API_URL, getAccessToken } from './api';

/**
 * Feature-usage pings ("view:calendar", "huddle:join"…) for the admin analytics.
 * Batched and sent every 20 s, and flushed when the tab is hidden/closed (with
 * `keepalive`, so the request survives the page going away). Best-effort: a
 * failed batch is dropped, never retried in a loop.
 */

let workspaceId: string | null = null;
let queue: { name: string }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let lastView: string | null = null;

function flush(): void {
  if (!workspaceId || queue.length === 0) return;
  const token = getAccessToken();
  if (!token) {
    queue = [];
    return;
  }
  const events = queue.splice(0, 50);
  void fetch(`${API_URL}/workspaces/${workspaceId}/usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
    keepalive: true,
  }).catch(() => undefined);
}

function ensureStarted(): void {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(flush, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

/** Which workspace pings belong to (switching flushes the previous one's queue). */
export function setUsageWorkspace(id: string | null): void {
  if (id === workspaceId) return;
  flush();
  workspaceId = id;
  lastView = null;
}

export function track(name: string): void {
  if (typeof window === 'undefined' || !USAGE_EVENT_NAME.test(name)) return;
  ensureStarted();
  queue.push({ name });
  if (queue.length >= 50) flush();
}

/** Track a main-view switch, ignoring repeats of the same view. */
export function trackView(view: string): void {
  if (view === lastView) return;
  lastView = view;
  track(`view:${view}`);
}
