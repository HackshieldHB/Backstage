'use client';

import { useEffect } from 'react';
import { api, getAccessToken } from '@/lib/api';

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Subscribe this browser to Web Push (so meeting reminders etc. arrive even with
 * no tab open). Needs a signed-in user, granted notification permission and
 * VAPID configured on the server; otherwise a no-op. Safe to call repeatedly.
 * Returns true when a subscription is registered with the server.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof Notification === 'undefined') {
    return false;
  }
  if (!getAccessToken() || Notification.permission !== 'granted') return false;
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
    const { vapidPublicKey } = await api<{ vapidPublicKey: string | null }>('GET', '/push/status');
    if (!vapidPublicKey) return false; // push delivery not configured server-side
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));
    const json = sub.toJSON();
    await api('POST', '/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
    return true;
  } catch {
    return false; // best-effort — push stays off if anything fails
  }
}

/** Asks for notification permission (if not decided yet), then subscribes to push. */
export async function enableNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (perm === 'granted') await subscribeToPush();
  return perm;
}

/** Registers the service worker and, when VAPID + notification permission are
 *  available, subscribes the browser to Web Push. No-ops otherwise. */
export function PwaRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;

    (async () => {
      const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
      if (!reg || cancelled) return;
      await subscribeToPush();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
