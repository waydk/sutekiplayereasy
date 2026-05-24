import type { CalendarAiringItem } from "./homeCalendar";
import { posterAssetUrl, warmPosterCache } from "./posterPreload";

const POSTER_MAP_KEY = "suteki:cal-shiki-posters:v1";
const POSTER_MAP_TTL_MS = 12 * 60 * 60 * 1000;

type PosterMapEnvelope = {
  savedAt: number;
  date: string;
  map: Record<string, string>;
};

function todayMsk(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}

function readEnvelope(): PosterMapEnvelope | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(POSTER_MAP_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as PosterMapEnvelope;
    if (!env?.map || !env.savedAt || env.date !== todayMsk()) return null;
    if (Date.now() - env.savedAt > POSTER_MAP_TTL_MS) return null;
    return env;
  } catch {
    return null;
  }
}

function writeEnvelope(map: Record<string, string>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const env: PosterMapEnvelope = {
      savedAt: Date.now(),
      date: todayMsk(),
      map,
    };
    sessionStorage.setItem(POSTER_MAP_KEY, JSON.stringify(env));
  } catch {
    /* quota */
  }
}

export function isShikimoriPosterUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /shikimori\.(one|io)/i.test(url) || url.includes("/system/animes/");
}

function absUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
  }
  return url;
}

function posterFromItem(item: CalendarAiringItem): string | null {
  const raw = (item.poster || "").trim();
  if (!raw) return null;
  if (isShikimoriPosterUrl(raw)) return absUrl(raw);
  return null;
}

/** URL постера календаря: Shikimori → sessionStorage → assets API. */
export function resolveCalendarPoster(item: CalendarAiringItem): string {
  const id = item.anime_id;
  if (id <= 0) return posterAssetUrl(0);

  const direct = posterFromItem(item);
  if (direct) {
    rememberCalendarPoster(id, direct);
    return direct;
  }

  const cached = readEnvelope()?.map[String(id)];
  if (cached) return cached;

  return posterAssetUrl(id);
}

export function rememberCalendarPoster(animeId: number, url: string): void {
  if (animeId <= 0 || !url) return;
  const env = readEnvelope();
  const map = { ...(env?.map ?? {}), [String(animeId)]: url };
  writeEnvelope(map);
}

export function rememberCalendarPosters(items: CalendarAiringItem[]): void {
  const env = readEnvelope();
  const map = { ...(env?.map ?? {}) };
  let changed = false;
  for (const item of items) {
    const url = posterFromItem(item);
    if (!url || item.anime_id <= 0) continue;
    const key = String(item.anime_id);
    if (map[key] !== url) {
      map[key] = url;
      changed = true;
    }
  }
  if (changed || !env) writeEnvelope(map);
}

/** Прогрев HTTP-кэша и SW для постеров календаря (Shikimori CDN). */
export function warmCalendarPosters(items: CalendarAiringItem[]): void {
  rememberCalendarPosters(items);
  const urls = items
    .map((item) => resolveCalendarPoster(item))
    .filter((u, i, arr) => u && arr.indexOf(u) === i);
  warmPosterCache(urls);
}
