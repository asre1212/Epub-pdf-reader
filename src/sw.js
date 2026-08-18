/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

const SHARE_CACHE = 'marginalia-share-inbox';

/**
 * Web Share Target.
 *
 * The manifest posts shared books to the app's scope. A POST cannot be handled
 * by the page, so the file is stashed in a cache here and the browser is
 * redirected to the app, which drains the cache on startup.
 *
 * Registered before the Workbox routes so it always gets first refusal on the
 * POST (Workbox only registers GET routes, but ordering makes that explicit).
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST') return;

  const scope = new URL(self.registration.scope);
  const url = new URL(request.url);
  if (url.origin !== scope.origin || url.pathname !== scope.pathname) return;

  event.respondWith(
    (async () => {
      try {
        const formData = await request.formData();
        const files = [
          ...formData.getAll('book'),
          ...formData.getAll('file'),
        ].filter((entry) => entry instanceof File && entry.size > 0);

        if (files.length) {
          const cache = await caches.open(SHARE_CACHE);
          let index = 0;
          for (const file of files) {
            await cache.put(
              new Request(`./shared-inbox/${Date.now()}-${index++}`),
              new Response(file, {
                headers: {
                  'content-type': file.type || 'application/octet-stream',
                  'x-filename': encodeURIComponent(file.name || 'shared-book'),
                },
              }),
            );
          }
        }
      } catch (err) {
        console.warn('Share target failed', err);
      }
      return Response.redirect(new URL('./?share-target=1', self.registration.scope).href, 303);
    })(),
  );
});

// A new worker waits until the page asks for it, so the app can decide when a
// reload is welcome. workbox-window's messageSkipWaiting() sends this.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Everything the reader needs is precached, so any navigation can be served
// from the app shell while offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// CMaps (CJK books) and the non-wasm decoder fallbacks are too large to precache
// for everyone, so they are kept the first time a PDF actually asks for them.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.includes('/pdfjs/'),
  new CacheFirst({ cacheName: 'pdfjs-runtime-assets' }),
);
