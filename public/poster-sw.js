/* Cache-first: постеры assets API + Shikimori CDN. */
const CACHE = "suteki-posters-v2";

function isPosterRequest(url) {
  if (url.includes("/api/v1/assets/anime/") && url.includes("poster.jpg")) return true;
  if (/shikimori\.(one|io)/i.test(url) && url.includes("/system/animes/")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith("suteki-posters-") && k !== CACHE).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (!isPosterRequest(url)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request, { mode: "cors", credentials: "omit" });
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
