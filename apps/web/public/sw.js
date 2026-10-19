// Minimal service worker: an app-shell offline fallback + Web Push display.
const CACHE = 'backstages-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network-first for navigations; fall back to cache when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('/app'))),
  );
});

// Web Push — sent by the API (VAPID) when the user has no Backstages tab open,
// e.g. "Sprint sync starts in 10 min".
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Backstages', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      // Same tag = replaces the earlier notification instead of stacking.
      ...(data.tag ? { tag: data.tag } : {}),
      data: data.url ? { url: data.url } : {},
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/app', self.location.origin).href;
  e.waitUntil(
    (async () => {
      // Reuse an open Backstages tab when there is one.
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        if ('navigate' in tab) await tab.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
