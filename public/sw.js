/*
 * Service worker: makes the site fast on slow or unreliable connections.
 *
 *  - The app shell (CSS, JavaScript, icons, logo) is cached and served instantly, then refreshed
 *    in the background ("stale-while-revalidate"), so new deploys arrive on the next visit.
 *  - Pages are loaded from the network first and fall back to the cached copy (or an offline page).
 *  - API responses are never cached: they contain personal data and must always be current.
 *
 * Bump VERSION to force every browser to drop its old cache.
 */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const SHELL_FILES = [
  '/css/app.css', '/css/site.css', '/js/theme.js', '/js/api.js', '/js/ui.js', '/js/site.js', '/js/portal.js',
  '/js/components.js', '/js/management.js', '/img/icons.svg', '/img/mark.png', '/img/icon-32.png', '/offline.html',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== PAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname.startsWith('/calendar/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(PAGES).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match('/offline.html'))));
    return;
  }

  if (/\.(css|js|svg|png|jpe?g|webp|gif|woff2?)$/.test(url.pathname) || url.pathname.startsWith('/files/')) {
    event.respondWith(caches.open(SHELL).then(cache => cache.match(request).then(hit => {
      const network = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => hit);
      return hit || network;
    })));
  }
});
