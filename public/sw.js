/**
 * Oh My Prompt — Service Worker
 * Cache-first for static assets, network-first for API calls.
 */

const STATIC_CACHE = "omp-static-v1";
const API_CACHE = "omp-api-cache";
const OFFLINE_PAGE = "/offline.html";

// Critical static assets to pre-cache
const STATIC_ASSETS = [
  "/",
  "/dashboard",
  "/offline.html",
  "/manifest.json",
  "/icon.svg",
  "/logo-dark.svg",
];

// API route prefixes that should use network-first strategy
const API_ROUTES = [
  "/api/prompts",
  "/api/sessions",
  "/api/search",
  "/api/analytics",
  "/api/insights",
  "/api/templates",
  "/api/user",
  "/api/teams",
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
          if (name !== STATIC_CACHE && name !== API_CACHE) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

/**
 * Check if a URL is an API route we should cache.
 */
function isApiRoute(url) {
  return API_ROUTES.some((route) => url.pathname.startsWith(route));
}

/**
 * Check if a request is for a static asset (JS, CSS, fonts, images).
 */
function isStaticAsset(url) {
  const staticExts = [".js", ".css", ".woff", ".woff2", ".png", ".jpg", ".svg", ".ico"];
  return staticExts.some((ext) => url.pathname.endsWith(ext));
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

  // Skip non-GET requests for caching (except API POSTs handled by bg sync)
  if (request.method !== "GET") {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // API routes: network first, cache fallback
  if (isApiRoute(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) {
              return cached;
            }
            return new Response(
              JSON.stringify({ error: "Offline — no cached data available" }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }
            );
          });
        })
    );
    return;
  }

  // Static assets: cache first, network fallback
  if (isStaticAsset(url) || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
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
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
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
          return caches.match(request).then((cached) => {
            if (cached) {
              return cached;
            }
            return caches.match(OFFLINE_PAGE).then((offline) => {
              if (offline) {
                return offline;
              }
              return new Response("Offline", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              });
            });
          });
        })
    );
    return;
  }

  // Default: network with simple cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Background sync for offline API calls
self.addEventListener("sync", (event) => {
  if (event.tag === "omp-sync") {
    event.waitUntil(
      // Replay queued requests if any
      broadcastMessage("sync-complete", { timestamp: Date.now() })
    );
  }
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
});
