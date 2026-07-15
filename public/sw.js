/**
 * Oh My Prompt — Service Worker
 * Cache only public static assets. Authenticated HTML and API responses are
 * intentionally network-only so data cannot leak between accounts.
 */

const STATIC_CACHE = "omp-static-v2";
const OFFLINE_PAGE = "/offline.html";

// Critical static assets to pre-cache
const STATIC_ASSETS = [
  "/offline.html",
  "/manifest.json",
  "/icon.svg",
  "/logo-dark.svg",
];

// Install: pre-cache critical assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== STATIC_CACHE && name.startsWith("omp-")) {
            return caches.delete(name);
          }
          return Promise.resolve(false);
        })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

/** Check if a URL belongs to the explicitly public static asset set. */
function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname);
}

/**
 * Broadcast a message to all clients.
 */
async function broadcastMessage(type, data) {
  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const client of clientsList) {
    client.postMessage({ type, data });
  }
}

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept mutations.
  if (request.method !== "GET") {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Authenticated API responses are network-only and never enter Cache Storage.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Static assets: cache first, network fallback
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => cache.match(request).then((cached) => {
        if (cached) {
          // Revalidate in background
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, response);
              });
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            cache.put(request, clone);
          }
          return response;
        });
      }))
    );
    return;
  }

  // HTML navigations: network first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          return response;
        })
        .catch(() => {
          return caches.open(STATIC_CACHE).then((cache) =>
            cache.match(OFFLINE_PAGE).then((offline) => {
              if (offline) {
                return offline;
              }
              return new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              });
            }),
          );
        })
    );
    return;
  }

  // All other requests use normal browser networking without cache fallback.
});

// Listen for messages from clients
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "OFFLINE_STATUS") {
    // Forward offline status to all clients
    broadcastMessage("offline-status", event.data);
  }
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "PURGE_PRIVATE_CACHES") {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name !== STATIC_CACHE && name.startsWith("omp-"))
            .map((name) => caches.delete(name)),
        ),
      ),
    );
  }
});
