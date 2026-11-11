/*
 * sw.js - the service worker that lets the app install and work offline.
 *
 * Strategy: network first. Every request for a file on this site goes to
 * the network first, and each good answer is saved in the cache. Only if
 * the network fails (for example, you're offline) is the saved copy used.
 * That way a merged change shows up the next time the app is opened online,
 * and the last version you saw still works offline.
 */

// Change this name only to throw away everything saved by an older version.
const CACHE = 'ccc-app-v1';

// Saved when the app is installed, so it works offline right away. The paths
// are relative to this file, which sits at the top of the site
// (https://<username>.github.io/<repository>/), not at the root of a domain.
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'ccc.js',
  'app.js',
  'manifest.webmanifest',
  'data/electromart.csv',
  'data/assumptions.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(APP_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

// Remove caches left by older versions, then take charge of open pages.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names
          .filter(function (name) { return name !== CACHE; })
          .map(function (name) { return caches.delete(name); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  // Only handle reading files from this site; anything else is left alone.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // The network failed: use the saved copy if there is one.
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    // Opening the app offline at an address that wasn't saved: show the app's page.
    if (request.mode === 'navigate') {
      const page = await cache.match('./');
      if (page) return page;
    }
    throw err;
  }
}
