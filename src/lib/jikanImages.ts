import { useEffect, useState } from "react";

/**
 * Метаданные картинки из Jikan (MyAnimeList) по id аниме.
 * У Shikimori id обычно совпадает с MAL id, поэтому запрос по id даёт точный
 * hi-res постер (поиск по названию ненадёжен: «one piece» → фильм, а не сериал).
 * Парсим по запросу (только для показанных карточек активной вкладки), без
 * сохранения на бэкенде. В пределах сессии кэшируем в памяти.
 */

const JIKAN_BASE = "https://api.jikan.moe/v4/anime";

export type JikanMeta = { image: string | null; year: number | null };

const memCache = new Map<number, JikanMeta>();
const inflight = new Map<number, Promise<JikanMeta>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Очередь запросов: ~360 мс между вызовами (лимит Jikan ~3 req/сек). */
let queueTail: Promise<unknown> = Promise.resolve();
function nextSlot(): Promise<void> {
  const slot = queueTail.then(() => sleep(360));
  queueTail = slot.catch(() => undefined);
  return slot;
}

async function requestJikanMeta(animeId: number): Promise<JikanMeta> {
  await nextSlot();
  try {
    const r = await fetch(`${JIKAN_BASE}/${animeId}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return { image: null, year: null };
    const j = (await r.json()) as {
      data?: {
        year?: number | null;
        aired?: { from?: string | null };
        images?: {
          webp?: { large_image_url?: string; image_url?: string };
          jpg?: { large_image_url?: string; image_url?: string };
        };
      };
    };
    const data = j?.data;
    const img = data?.images;
    const image =
      img?.webp?.large_image_url ||
      img?.jpg?.large_image_url ||
      img?.webp?.image_url ||
      img?.jpg?.image_url ||
      null;
    let year = Number(data?.year) || null;
    if (!year && data?.aired?.from) {
      const y = new Date(data.aired.from).getFullYear();
      if (Number.isFinite(y)) year = y;
    }
    return { image, year };
  } catch {
    return { image: null, year: null };
  }
}

export function fetchJikanMeta(animeId: number): Promise<JikanMeta> {
  const cached = memCache.get(animeId);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(animeId);
  if (existing) return existing;
  const p = requestJikanMeta(animeId)
    .then((meta) => {
      memCache.set(animeId, meta);
      return meta;
    })
    .finally(() => {
      inflight.delete(animeId);
    });
  inflight.set(animeId, p);
  return p;
}

/** Хук: метаданные Jikan (картинка + год). null — пока грузится. */
export function useJikanMeta(animeId: number, enabled = true): JikanMeta | null {
  const [meta, setMeta] = useState<JikanMeta | null>(() => memCache.get(animeId) ?? null);

  useEffect(() => {
    if (!enabled || animeId <= 0) return;
    const cached = memCache.get(animeId);
    if (cached) {
      setMeta(cached);
      return;
    }
    let active = true;
    void fetchJikanMeta(animeId).then((m) => {
      if (active) setMeta(m);
    });
    return () => {
      active = false;
    };
  }, [animeId, enabled]);

  return meta;
}
