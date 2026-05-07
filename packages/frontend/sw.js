const CACHE_NAME = "panna-cotta-v12";
const ASSETS = [
  "/apps/index.html",
  "/apps/reset.css",
  "/apps/style.css",
  "/apps/app.js",
  "/apps/manifest.json",
  "/apps/assets/favicon.ico",
  "/apps/assets/apple-touch-icon.png",
  "/apps/assets/icon-192.png",
  "/apps/assets/icon-512.png",
  "/apps/assets/maskable-icon.png",
  "/apps/assets/splash.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      )
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don't cache API calls
  if (url.pathname.startsWith("/api")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    }),
  );
});
