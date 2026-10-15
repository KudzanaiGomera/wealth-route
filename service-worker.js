const CACHE_NAME = 'wealthroute-shell-v124';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './tests.html',
  './vendor/purify.min.js',
  './vendor/papaparse.min.js',
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
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
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
