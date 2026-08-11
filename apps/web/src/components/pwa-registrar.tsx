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

/** Registers the service worker and, when VAPID + notification permission are
 *  available, subscribes the browser to Web Push. No-ops otherwise. */
export function PwaRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;

    (async () => {
      const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
      if (!reg || cancelled) return;

      // Only attempt push once the user is signed in and has granted permission.
      if (!getAccessToken() || Notification.permission !== 'granted') return;
      try {
        const { vapidPublicKey } = await api<{ vapidPublicKey: string | null }>('GET', '/push/status');
        if (!vapidPublicKey) return; // push delivery not configured server-side
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          }));
        const json = sub.toJSON();
        await api('POST', '/push/subscribe', {
          endpoint: json.endpoint,
          keys: json.keys,
        });
      } catch {
        // best-effort — push stays off if anything fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
