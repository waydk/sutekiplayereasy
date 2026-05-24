/* Cache-first для /api/v1/assets/anime/*/poster.jpg — повторные визиты мгновенные. */
const CACHE = "suteki-posters-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (!url.includes("/api/v1/assets/anime/") || !url.includes("poster.jpg")) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) {
        try {
          await cache.put(event.request, res.clone());
        } catch {
          /* quota */
        }
      }
      return res;
    }),
  );
});
