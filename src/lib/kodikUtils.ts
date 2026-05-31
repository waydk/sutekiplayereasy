export type TranslationRow = {
  id?: string | number;
  translation_id?: string | number;
  name?: string;
  type?: string;
  title?: string;
  translation?: string;
  series_range?: [number, number];
};

/** Kodik допускает translation_id === 0 («неизвестно»); не использовать truthiness от id. */
export function translationRowHasId(t: TranslationRow | null | undefined): boolean {
  if (!t || typeof t !== "object") return false;
  if ("id" in t && t.id !== undefined && t.id !== null) return true;
  if ("translation_id" in t && t.translation_id !== undefined && t.translation_id !== null) return true;
  return false;
}

export function translationRowIdString(t: TranslationRow | null | undefined): string {
  if (!t) return "";
  const raw = t.id ?? t.translation_id;
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

/** Kodik помечает фильмы series_range [0, 0] — не путать с TV диапазоном. */
export function isMovieSeriesRange(r: unknown): boolean {
  if (!Array.isArray(r) || r.length !== 2) return false;
  return Number(r[0]) === 0 && Number(r[1]) === 0;
}

export function translationHasValidSeriesRange(t: TranslationRow | null | undefined): boolean {
  if (!t) return false;
  const sr = t.series_range;
  if (!Array.isArray(sr) || sr.length !== 2) return false;
  return !isMovieSeriesRange(sr);
}

export type EpisodeOpt = { value: string; label: string; disabled: boolean };

export function formatTranslationLabel(t: TranslationRow): string {
  const name = String(t?.name || "").trim();
  const type = String(t?.type || "").trim();
  if (name && type) return `${name} • ${type}`;
  return name || type || `translation ${t?.id ?? "—"}`;
}

export function translationEpisodesCount(t: TranslationRow): number | null {
  const r = t && Array.isArray(t.series_range) ? t.series_range : null;
  if (!r || r.length !== 2) return null;
  const a = Number(r[0]) || 0;
  const b = Number(r[1]) || 0;
  if (a <= 0 || b <= 0 || b < a) return null;
  return b - a + 1;
}

export function pickFirstTranslationId(watch: { translations?: TranslationRow[] } | null): string | null {
  const trs = watch && typeof watch === "object" && Array.isArray(watch.translations) ? watch.translations : [];
  const first = trs.find((t) => translationRowHasId(t));
  return first ? translationRowIdString(first) : null;
}

/** Озвучка, в чей series_range входит серия; иначе первая без диапазона или первая в списке. */
export function pickTranslationForEpisode(
  watch: { translations?: TranslationRow[] } | null | undefined,
  episode: number,
): string | null {
  const ep = Math.max(1, Math.floor(Number(episode) || 1));
  const trs = (watch?.translations || []).filter((t) => translationRowHasId(t));
  if (!trs.length) return null;

  for (const t of trs) {
    const r = t.series_range;
    if (isMovieSeriesRange(r)) return translationRowIdString(t);
    if (!Array.isArray(r) || r.length !== 2) continue;
    const a = Number(r[0]);
    const b = Number(r[1]);
    if (a > 0 && b >= a && ep >= a && ep <= b) return translationRowIdString(t);
  }

  const withoutRange = trs.find((t) => {
    const r = t.series_range;
    return !Array.isArray(r) || r.length !== 2;
  });
  if (withoutRange) return translationRowIdString(withoutRange);

  let best: TranslationRow | null = null;
  let bestStart = Number.POSITIVE_INFINITY;
  for (const t of trs) {
    const r = t.series_range;
    if (!Array.isArray(r) || r.length !== 2) continue;
    const a = Number(r[0]);
    if (a > 0 && a <= ep && a < bestStart) {
      bestStart = a;
      best = t;
    }
  }
  if (best) return translationRowIdString(best);

  return pickFirstTranslationId(watch ?? null);
}

/** Есть ли у выбранной озвучки series_range — тогда список серий можно собрать без GET /episodes. */
export function translationHasSeriesRangeForTranslationId(
  watch: { translations?: TranslationRow[] } | null | undefined,
  translationId: string,
): boolean {
  const tid = String(translationId || "").trim();
  if (!tid || !watch?.translations) return false;
  for (const t of watch.translations) {
    if (translationRowIdString(t) !== tid) continue;
    const sr = t.series_range;
    return translationHasValidSeriesRange(t);
  }
  return false;
}

/** Форма ответа GET /episodes (сезоны + translations), как на бэкенде build_kodik_episodes_payload. */
export type KodikEpisodesApiPayload = {
  series_count: number;
  season_size: number;
  seasons: Array<{
    season: number;
    start: number;
    end: number;
    episodes: Array<{
      episode: number;
      title: string;
      subtitle: null;
      thumb_url: null;
      duration_min: null;
      available: boolean;
    }>;
  }>;
  provider: string;
  translations: TranslationRow[];
};

/** Локальная сборка payload серий из ответа /watch (без сетевого /episodes), если известен series_range. */
export function buildKodikEpisodesPayloadFromWatch(
  watch: { series_count?: number; translations?: TranslationRow[] },
  translationId: string,
  seasonSize = 12,
): KodikEpisodesApiPayload {
  const translations = Array.isArray(watch.translations) ? watch.translations : [];
  let trRange: [number, number] | null = null;
  const tid = String(translationId || "").trim();
  if (tid) {
    for (const t of translations) {
      if (translationRowIdString(t) !== tid) continue;
      const sr = t.series_range;
      if (Array.isArray(sr) && sr.length === 2) {
        if (isMovieSeriesRange(sr)) trRange = [1, 1];
        else trRange = [Number(sr[0]) || 1, Number(sr[1]) || 0];
      }
      break;
    }
  }

  let total = Math.max(0, Math.floor(Number(watch.series_count) || 0));
  if (!total) {
    const movieMarker = translations.some((t) => isMovieSeriesRange(t.series_range));
    total = movieMarker || (trRange && trRange[0] === 1 && trRange[1] === 1) ? 1 : 12;
  }

  const size = Math.max(1, seasonSize);
  const seasons: KodikEpisodesApiPayload["seasons"] = [];

  function isAvail(ep: number): boolean {
    if (!trRange) return true;
    const [s, e] = trRange;
    if (e <= 0) return ep >= s;
    return ep >= s && ep <= e;
  }

  if (total <= 0) {
    return { series_count: 0, season_size: size, seasons: [], provider: "kodik", translations };
  }

  const seasonCount = Math.max(1, Math.ceil(total / size));
  for (let s = 1; s <= seasonCount; s++) {
    const start = (s - 1) * size + 1;
    const end = Math.min(total, s * size);
    const episodes: KodikEpisodesApiPayload["seasons"][0]["episodes"] = [];
    for (let ep = start; ep <= end; ep++) {
      episodes.push({
        episode: ep,
        title: `${ep} серия`,
        subtitle: null,
        thumb_url: null,
        duration_min: null,
        available: isAvail(ep),
      });
    }
    seasons.push({ season: s, start, end, episodes });
  }

  return {
    series_count: total,
    season_size: size,
    seasons,
    provider: "kodik",
    translations,
  };
}

/** Быстрый iframe без GET /kodik/link — как build_kodik_embed_watch_url на бэкенде. */
export function buildKodikEmbedWatchUrl(
  embedBase: string,
  episode: number,
  translationId: string,
): string {
  const base = (embedBase || "").trim();
  if (!base) return "";
  try {
    const u = new URL(base);
    u.searchParams.set("episode", String(Math.max(1, Math.floor(episode) || 1)));
    const tid = String(translationId || "").trim();
    if (tid) u.searchParams.set("translation_id", tid);
    if (!u.searchParams.has("only_episode")) u.searchParams.set("only_episode", "true");
    return u.toString();
  } catch {
    return "";
  }
}

export function buildEpisodesOptions(episodesPayload: {
  seasons?: { season?: number; episodes?: { episode?: number; available?: boolean }[] }[];
} | null): EpisodeOpt[] {
  const seasons =
    episodesPayload && typeof episodesPayload === "object" && Array.isArray(episodesPayload.seasons)
      ? episodesPayload.seasons
      : [];
  const out: EpisodeOpt[] = [];
  for (const s of seasons) {
    const eps = s && typeof s === "object" && Array.isArray(s.episodes) ? s.episodes : [];
    for (const e of eps) {
      const n = e && typeof e === "object" ? Number(e.episode) : NaN;
      if (!Number.isFinite(n) || n <= 0) continue;
      const avail = e.available !== false;
      out.push({ value: String(n), label: `Серия ${n}${avail ? "" : " (недоступно)"}`, disabled: !avail });
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.value) ? false : (seen.add(x.value), true)));
}

export function availableQualities(maxQ: number | null | undefined): number[] {
  const mq = Number(maxQ) || 0;
  const opts: number[] = [];
  for (const q of [360, 480, 720]) {
    if (mq >= q) opts.push(q);
  }
  return opts.length ? opts : [360, 480, 720];
}

/** Качества из ответа Kodik API (probe на бэкенде) или fallback по kodik_max_quality. */
export function qualitiesFromKodikLink(
  link: { kodik_available_qualities?: number[] | null; kodik_max_quality?: number | null } | null | undefined,
): number[] {
  const raw = link?.kodik_available_qualities;
  if (Array.isArray(raw) && raw.length) {
    const uniq = [...new Set(raw.map((q) => Number(q)).filter((q) => Number.isFinite(q) && q > 0))].sort(
      (a, b) => a - b,
    );
    if (uniq.length) return uniq;
  }
  return availableQualities(link?.kodik_max_quality);
}

export function inferQualityFromUrl(url: string): number | null {
  const m = String(url || "").match(/(?:\/|^)(360|480|720)\.mp4(?:\?|#|$)/);
  return m ? Number(m[1]) : null;
}

export function replaceQualityInUrl(url: string, q: number): string {
  const s = String(url || "");
  if (!s) return s;
  if (/(360|480|720)\.mp4(?:\?|#|$)/.test(s)) {
    return s.replace(/(360|480|720)\.mp4(?=(\?|#|$))/, String(q) + ".mp4");
  }
  return s;
}

/**
 * При заданном NEXT_PUBLIC_API_BASE видео запрашивается с origin бэкенда (например http://127.0.0.1:8000),
 * минуя Next.js — в dev иначе часто ломаются Range/streaming и плеер даёт MEDIA_ERR_SRC_NOT_SUPPORTED (code 4).
 * Переопределение: NEXT_PUBLIC_MEDIA_ORIGIN (только origin, без пути).
 */
function mediaProxyOrigin(): string | null {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  const explicit = import.meta.env.VITE_MEDIA_ORIGIN?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      return null;
    }
  }
  const apiBase = import.meta.env.VITE_API_BASE?.trim();
  if (!apiBase) return null;
  try {
    return new URL(apiBase, "http://localhost").origin;
  } catch {
    return null;
  }
}

function directMp4Enabled(): boolean {
  return import.meta.env.VITE_DIRECT_MP4 === "1";
}

function directHlsEnabled(): boolean {
  return import.meta.env.VITE_DIRECT_HLS === "1";
}

export function proxifyMediaUrl(u: string, opts?: { direct?: boolean }): string {
  const raw = String(u || "").trim();
  if ((opts?.direct || directMp4Enabled()) && (raw.startsWith("https://") || raw.startsWith("http://"))) {
    return raw;
  }
  const path = `/api/v1/media/kodik?url=${encodeURIComponent(raw)}`;
  const origin = mediaProxyOrigin();
  if (origin) return `${origin}${path}`;
  return path;
}

/** Прокси m3u8 с переписанными сегментами (см. backend GET /api/v1/media/kodik-hls). */
export function proxifyHlsPlaylistUrl(u: string): string {
  const path = `/api/v1/media/kodik-hls?url=${encodeURIComponent(String(u || ""))}`;
  const origin = mediaProxyOrigin();
  if (origin) return `${origin}${path}`;
  return path;
}

/**
 * Мастер-плейлист HLS: прямой URL на CDN или прокси (переписанные сегменты под ваш origin).
 * Прямой режим (`NEXT_PUBLIC_DIRECT_HLS=1`) возможен только если CDN отдаёт CORS для вашего
 * origin на m3u8 и на все ссылки из плейлиста (включая сегменты). Иначе в DevTools — CORS error.
 */
export function resolveHlsManifestUrl(u: string): string {
  const raw = String(u || "").trim();
  if (directHlsEnabled() && (raw.startsWith("https://") || raw.startsWith("http://"))) {
    return raw;
  }
  return proxifyHlsPlaylistUrl(raw);
}
