// Service worker for the PWA install/offline-cold-start story. Deliberately
// narrow in scope: experimental.useOffline (next.config.ts) already handles
// a tab that's already open going offline mid-session (Server Actions sit
// pending and retry once connectivity returns — this worker must not
// interfere with that, so it never intercepts non-GET requests at all).
// What this worker adds is what useOffline can't: launching the app fresh —
// from the home-screen icon, a bookmark, a reopened tab — with zero
// connectivity from the start.
const CACHE_VERSION = "v1";
const SHELL_CACHE = `zettelkasten-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `zettelkasten-assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only ever handle same-origin GETs — POSTs (Server Actions, sign-in) and
  // cross-origin requests pass straight through untouched.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    // Page navigations always prefer a live network response (this app's
    // screens are session/DB-driven, not something a cache should serve
    // stale) and only fall back to the cached offline shell when the
    // network is genuinely unreachable.
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (request.url.includes("/_next/static/") || request.destination === "image" || request.destination === "font") {
    // Build assets are content-hashed and immutable, and icons/fonts rarely
    // change — cache-first so once a page has been opened online, its JS,
    // CSS, and image/font assets keep working from a cold, fully offline
    // launch too.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
