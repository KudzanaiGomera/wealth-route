const CACHE_NAME = 'wealthroute-shell-v206';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './tests.html',
  './vendor/purify.min.js',
  './vendor/papaparse.min.js',
  './vendor/jspdf.umd.min.js',
  './favicon-16.png',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('wealthroute-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only same-origin http(s) requests are cacheable; chrome-extension:// and
  // other schemes throw on Cache.put and must be passed straight through.
  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          }
          return caches.match(event.request).then((cached) => cached || response);
        })
        .catch(async () => (await caches.match('./index.html')) || (await caches.match('./')) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL('./#/notifications', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const appClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (appClient) {
      await appClient.navigate(destination);
      return appClient.focus();
    }
    return self.clients.openWindow(destination);
  }));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === 'string' ? payload.title : 'WealthRoute reminder',
    {
      body: typeof payload.body === 'string' ? payload.body : 'You have an upcoming payment reminder.',
      tag: typeof payload.tag === 'string' ? payload.tag : 'wealthroute-reminder',
      icon: './icon-192.png',
      badge: './favicon-32.png',
      data: { url: './#/notifications' },
    },
  ));
});
