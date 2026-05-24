import { fetchTodayCalendar, type TodayCalendarPayload } from "./homeCalendar";
import { posterAssetUrl, warmPosterIds } from "./posterPreload";
import { RECOMMENDED_ANIME } from "./topAnime";

let calendarPromise: Promise<TodayCalendarPayload> | null = null;

export function isHomeRoute(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const idRaw =
    params.get("shiki_id") ||
    params.get("shikimori_id") ||
    params.get("anime_id") ||
    params.get("id");
  if (idRaw && Number(idRaw) > 0) return false;
  const sp = params.get("tgWebAppStartParam") || "";
  if (/^shiki[_-]?\d+$/i.test(sp) || /^\d+$/.test(sp)) return false;
  return true;
}

/** Один запрос календаря на сессию главной (main + HomeCalendar). */
export function ensureHomeCalendar(): Promise<TodayCalendarPayload> {
  if (!calendarPromise) {
    calendarPromise = fetchTodayCalendar();
  }
  return calendarPromise;
}

/** Старт до mount React: рекомендации + календарь + постеры. */
export function kickHomePreload(): void {
  if (!isHomeRoute()) return;

  warmPosterIds(RECOMMENDED_ANIME.map((a) => a.shikiId));

  void ensureHomeCalendar().then((cal) => {
    const ids = cal.items.map((x) => x.anime_id).filter((id) => id > 0);
    warmPosterIds(ids);
  });
}

export function calendarPosterSrc(animeId: number): string {
  return posterAssetUrl(animeId);
}
