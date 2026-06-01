/** Предзагрузка постеров в HTTP-кэш браузера до появления <img>. */

const hinted = new Set<string>();

const POSTER_CACHE_BUST = "20260528";

export function posterAssetUrl(animeId: number): string {
  return `/api/v1/assets/anime/${animeId}/poster.jpg?v=${POSTER_CACHE_BUST}`;
}

/** Горизонтальный кадр (landscape) — для карточек «Продолжить просмотр». */
export function heroAssetUrl(animeId: number): string {
  return `/api/v1/assets/anime/${animeId}/hero.jpg?v=${POSTER_CACHE_BUST}`;
}

function isCrossOriginPoster(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
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
    if (isCrossOriginPoster(href)) {
      link.crossOrigin = "anonymous";
    }
    document.head.appendChild(link);
  }
}

export function preloadPosterImages(urls: string[]): void {
  if (typeof Image === "undefined") return;
  for (const src of urls) {
    if (!src) continue;
    const img = new Image();
    img.decoding = "async";
    if (isCrossOriginPoster(src)) {
      img.crossOrigin = "anonymous";
    }
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
    if (!isCrossOriginPoster(url)) {
      void fetch(url, { credentials: "same-origin", priority: "high" }).catch(() => {});
    }
  }
}

export function warmPosterIds(animeIds: number[]): void {
  warmPosterCache(animeIds.map(posterAssetUrl));
}
