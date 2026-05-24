/** Предзагрузка постеров в HTTP-кэш браузера до появления <img>. */

const hinted = new Set<string>();

export function posterAssetUrl(animeId: number): string {
  return `/api/v1/assets/anime/${animeId}/poster.jpg?v=poster`;
}

export function preloadPosterLinkHints(urls: string[]): void {
  if (typeof document === "undefined") return;
  for (const href of urls) {
    if (!href || hinted.has(href)) continue;
    hinted.add(href);
    if (document.querySelector(`link[rel="preload"][as="image"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    document.head.appendChild(link);
  }
}

export function preloadPosterImages(urls: string[]): void {
  if (typeof Image === "undefined") return;
  for (const src of urls) {
    if (!src) continue;
    const img = new Image();
    img.decoding = "async";
    try {
      (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "high";
    } catch {
      /* */
    }
    img.src = src;
  }
}

/** fetch + Image — максимально рано кладём байты в кэш. */
export function warmPosterCache(urls: string[]): void {
  preloadPosterLinkHints(urls);
  preloadPosterImages(urls);
  if (typeof fetch === "undefined") return;
  for (const url of urls) {
    if (!url) continue;
    void fetch(url, { credentials: "same-origin", priority: "high" }).catch(() => {});
  }
}

export function warmPosterIds(animeIds: number[]): void {
  warmPosterCache(animeIds.map(posterAssetUrl));
}
