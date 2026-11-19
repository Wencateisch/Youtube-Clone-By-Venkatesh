// Bump this on every release. Cache-first for immutable art, network-first for
// the app shell: a stale shell is worse than an offline miss, and the previous
// cache-first version meant users kept the old CSS/JS for months.
const CACHE_NAME = "yt-clone-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./index.css",
  "./index.js",
  "./config.json",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      // Take over open pages. The page itself decides whether to reload once
      // (index.html), so a video that is playing is never interrupted.
      .then(() => self.clients.claim())
  );
});

const SHELL_RE = /\.(html|css|js|json|webmanifest)$/i;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isShell =
    request.mode === "navigate" || SHELL_RE.test(url.pathname) || url.pathname.endsWith("/");

  if (isShell) {
    // Network first: always pick up a new deploy; fall back to cache offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Everything else (icons, thumbnails, static art) is cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
