/* Cache-first только для same-origin /api/v1/assets/.../poster.jpg.
   Shikimori CDN не трогаем — иначе CORS ломает <img> в плеере. */
const CACHE = "suteki-posters-v3";

function isAssetPosterRequest(url) {
  try {
    const u = new URL(url);
    if (u.pathname.includes("/api/v1/assets/anime/") && u.pathname.endsWith("/poster.jpg")) {
      return u.origin === self.location.origin;
    }
  } catch {
    /* */
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("suteki-posters-") && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isAssetPosterRequest(event.request.url)) return;
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
