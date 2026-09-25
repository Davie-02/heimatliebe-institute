/*
 * Offline support and instant repeat visits.
 *
 * - The site's own files (hashed JS/CSS under /assets, icons, logo) are kept in a cache and served
 *   from it first: they never change once published, so this is always safe.
 * - Pages (navigation) go to the network first and fall back to the cached app shell, then to the
 *   offline page when there's no connection at all.
 * - API requests are NEVER cached here: they can contain personal data and must always be current.
 */
const VERSION = "hml-v2";
const SHELL = ["/", "/offline.html", "/img/logo.webp", "/img/icons.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || caches.match("/offline.html")))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/img/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
