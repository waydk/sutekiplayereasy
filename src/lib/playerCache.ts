import { warmMp4HeadWindow } from "./progressiveBuffer";
import { getSutekiApiClient } from "./startupPolicy";
import { hubApiUrl, playerBootstrapUrl, type PlayerBootstrapResponse } from "./playerApi";

export type KodikLinkResponse = {
  player_url?: string;
  kodik_max_quality?: number | null;
  kodik_available_qualities?: number[] | null;
  hls_manifest_url?: string;
  prefer_hls?: boolean;
  opening_end_sec?: number | null;
  op_end_sec?: number | null;
  skip_opening_to_sec?: number | null;
  ending_start_sec?: number | null;
  ed_start_sec?: number | null;
  ending_skip_to_sec?: number | null;
  skip_ending_to_sec?: number | null;
};

type CacheEntry<T> = { value: T; expiresAt: number; touchedAt: number };
const CACHE_MAX_ITEMS = 140;
export const CACHE_TTL_LINK_MS = 60_000;
export const CACHE_TTL_BOOTSTRAP_MS = 75_000;
export const CACHE_TTL_EPISODES_MS = 120_000;

export function cacheGet<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const now = Date.now();
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  e.touchedAt = now;
  store.set(key, e);
  return e.value;
}

export function cacheSet<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  store.set(key, { value, expiresAt: now + ttlMs, touchedAt: now });
  if (store.size <= CACHE_MAX_ITEMS) return;
  let oldestKey: string | null = null;
  let oldestTouch = Number.POSITIVE_INFINITY;
  for (const [k, v] of store) {
    if (v.touchedAt < oldestTouch) {
      oldestTouch = v.touchedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export const linkCache = new Map<string, CacheEntry<KodikLinkResponse>>();
export const bootstrapCache = new Map<string, CacheEntry<PlayerBootstrapResponse>>();

const bootstrapInflight = new Map<string, Promise<PlayerBootstrapResponse>>();
const linkInflight = new Map<string, Promise<KodikLinkResponse | null>>();

function bootstrapKey(animeId: number, translationId: string | null, episode: number): string {
  return `${animeId}:${(translationId ?? "").trim() || "auto"}:${episode}`;
}

function linkKey(animeId: number, translationId: string, episode: number): string {
  return `${animeId}:${translationId}:${episode}`;
}

function apiFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const client = getSutekiApiClient();
  if (client) headers["X-Suteki-Client"] = client;
  return headers;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, {
    headers: apiFetchHeaders(),
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const j = (await r.json().catch(() => ({}))) as T;
  if (!r.ok) {
    let detailText = "";
    if (j && typeof j === "object" && j !== null && "detail" in j) {
      const d = (j as { detail?: unknown }).detail;
      if (typeof d === "string") detailText = d;
    }
    /* Сохраняем HTTP-код в начале — formatApiError маппит по коду на UI-сообщение. */
    throw new Error(detailText ? `HTTP ${r.status} ${detailText}` : `HTTP ${r.status}`);
  }
  return j;
}

type SutekiBoot = {
  params?: { animeId: number; translationId: string | null; episode: number };
  bootstrap?: Promise<PlayerBootstrapResponse>;
  consumed?: boolean;
};

/** Inline-script в index.html стартует bootstrap до загрузки JS — забираем результат.
 * Если head-prefetch упал (dev/локалка), возвращаем null чтобы warmBootstrap сделал обычный fetch. */
function consumeHeadPrefetch(
  animeId: number,
  translationId: string | null,
  episode: number,
): Promise<PlayerBootstrapResponse> | null {
  if (typeof window === "undefined") return null;
  const boot = (window as unknown as { __sutekiBoot__?: SutekiBoot }).__sutekiBoot__;
  if (!boot || boot.consumed || !boot.bootstrap || !boot.params) return null;
  const p = boot.params;
  const tidA = (p.translationId ?? "").trim();
  const tidB = (translationId ?? "").trim();
  if (p.animeId !== animeId) return null;
  if (p.episode !== episode) return null;
  if (tidA && tidB && tidA !== tidB) return null;
  boot.consumed = true;
  /* Wrap: ошибки head-fetch не должны проваливать warmBootstrap, а пробрасывать
     поток в обычный API-fetch. Мы возвращаем Promise<reject>, caller обработает и попробует ещё раз. */
  return boot.bootstrap;
}

function applyBootstrapToCache(
  animeId: number,
  translationId: string | null,
  episode: number,
  data: PlayerBootstrapResponse,
): void {
  cacheSet(bootstrapCache, bootstrapKey(animeId, translationId, episode), data, CACHE_TTL_BOOTSTRAP_MS);
  const tid = String(data.translation_id ?? translationId ?? "").trim();
  const ep = Math.max(1, Math.floor(Number(data.episode ?? episode) || 1));
  const srvLink = data.link as (KodikLinkResponse & { unavailable?: boolean }) | null | undefined;
  if (
    tid &&
    srvLink &&
    !srvLink.unavailable &&
    typeof srvLink.player_url === "string" &&
    srvLink.player_url.trim()
  ) {
    const link = srvLink as KodikLinkResponse;
    cacheSet(linkCache, linkKey(animeId, tid, ep), link, CACHE_TTL_LINK_MS);
    const url = link.player_url || "";
    preloadMp4Url(url);
    warmMp4HeadWindow(url, { direct: true, lite: Boolean(getSutekiApiClient()) });
  }
}

/** Старт bootstrap до mount React (deep link / Telegram). */
export function warmBootstrap(
  animeId: number,
  translationId: string | null,
  episode: number,
): Promise<PlayerBootstrapResponse> | null {
  if (animeId <= 0) return null;
  const key = bootstrapKey(animeId, translationId, episode);
  const cached = cacheGet(bootstrapCache, key);
  if (cached) return Promise.resolve(cached);
  const inflight = bootstrapInflight.get(key);
  if (inflight) return inflight;

  /* head-prefetch: переиспользуем уже летящий запрос из index.html */
  const head = consumeHeadPrefetch(animeId, translationId, episode);
  const apiClient = getSutekiApiClient();
  const url = playerBootstrapUrl(animeId, {
    translationId,
    episode,
    includeLink: true,
    client: apiClient,
  });

  /* Если head-fetch упал (dev / cold cache / network err) — мгновенно делаем обычный fetch. */
  const sourcePromise = head
    ? head.catch(() => fetchJson<PlayerBootstrapResponse>(url))
    : fetchJson<PlayerBootstrapResponse>(url);

  const p = sourcePromise
    .then((data) => {
      applyBootstrapToCache(animeId, translationId, episode, data);
      return data;
    })
    .finally(() => {
      bootstrapInflight.delete(key);
    });
  bootstrapInflight.set(key, p);
  return p;
}

export function warmLink(animeId: number, translationId: string, episode: number): Promise<KodikLinkResponse | null> | null {
  const tid = translationId.trim();
  if (!tid || animeId <= 0) return null;
  const key = linkKey(animeId, tid, episode);
  const cached = cacheGet(linkCache, key);
  if (cached?.player_url) return Promise.resolve(cached);
  const inflight = linkInflight.get(key);
  if (inflight) return inflight;
  const url = hubApiUrl(
    `/anime/${encodeURIComponent(animeId)}/kodik/link?episode=${encodeURIComponent(episode)}&translation_id=${encodeURIComponent(tid)}`,
  );
  const p = fetchJson<KodikLinkResponse>(url)
    .then((out) => {
      if (out?.player_url) cacheSet(linkCache, key, out, CACHE_TTL_LINK_MS);
      return out;
    })
    .catch(() => null)
    .finally(() => {
      linkInflight.delete(key);
    });
  linkInflight.set(key, p);
  return p;
}

export function takeWarmBootstrap(
  animeId: number,
  translationId: string | null,
  episode: number,
): PlayerBootstrapResponse | null {
  return cacheGet(bootstrapCache, bootstrapKey(animeId, translationId, episode));
}

export function takeWarmLink(animeId: number, translationId: string, episode: number): KodikLinkResponse | null {
  return cacheGet(linkCache, linkKey(animeId, translationId, episode));
}

export function preloadMp4Url(mp4Url: string): void {
  if (typeof document === "undefined") return;
  const raw = String(mp4Url || "").trim();
  if (!raw.startsWith("http")) return;
  let href = raw;
  try {
    href = new URL(raw).href;
  } catch {
    return;
  }
  const id = `suteki-mp4-preload-${href.slice(-48)}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "preload";
  link.as = "video";
  link.href = href;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

export function preconnectMediaOrigin(url: string): void {
  if (typeof document === "undefined") return;
  const raw = String(url || "").trim();
  if (!raw.startsWith("http")) return;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    return;
  }
  const id = `suteki-media-preconnect-${origin}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}
