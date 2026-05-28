/** Прогресс просмотра: позиция в серии + последняя серия/озвучка (localStorage). */

export type LastWatchRecord = {
  translationId: string;
  episode: number;
  positionSec: number;
  updatedAt: number;
  title?: string;
};

export type ContinueWatchEntry = {
  animeId: number;
  title: string;
  poster?: string | null;
  translationId: string;
  episode: number;
  positionSec: number;
  updatedAt: number;
  progressLabel: string;
};

const MIN_CONTINUE_SEC = 30;

const RESUME_PREFIX = "sh.resume:v1:";
const LAST_PREFIX = "sh.last:v1:";

export function formatClockSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatResumeHint(episode: number, positionSec: number): string {
  const ep = Math.max(1, Math.floor(episode) || 1);
  const t = formatClockSec(positionSec);
  return `Серия ${ep} · продолжаем с ${t}`;
}

function resumeKey(animeId: number, translationId: string, episode: number): string {
  return `${RESUME_PREFIX}${animeId}:${translationId}:${episode}`;
}

function lastKey(animeId: number): string {
  return `${LAST_PREFIX}${animeId}`;
}

export function readResumeSec(animeId: number, translationId: string, episode: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(resumeKey(animeId, translationId, episode));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0.5 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function writeResumeSec(
  animeId: number,
  translationId: string,
  episode: number,
  sec: number,
): void {
  if (typeof window === "undefined") return;
  try {
    if (!Number.isFinite(sec) || sec <= 0.5) {
      window.localStorage.removeItem(resumeKey(animeId, translationId, episode));
      return;
    }
    window.localStorage.setItem(resumeKey(animeId, translationId, episode), String(Math.floor(sec)));
  } catch {
    /* */
  }
}

export function readLastWatch(animeId: number): LastWatchRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastKey(animeId));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<LastWatchRecord>;
    const translationId = typeof j.translationId === "string" ? j.translationId.trim() : "";
    const episode = Math.floor(Number(j.episode) || 0);
    const positionSec = Math.floor(Number(j.positionSec) || 0);
    const updatedAt = Math.floor(Number(j.updatedAt) || 0);
    if (!translationId || episode < 1) return null;
    const title = typeof j.title === "string" ? j.title.trim() : "";
    return {
      translationId,
      episode,
      positionSec: positionSec > 0 ? positionSec : 0,
      updatedAt: updatedAt > 0 ? updatedAt : Date.now(),
      title: title || undefined,
    };
  } catch {
    return null;
  }
}

export function writeLastWatch(animeId: number, record: Omit<LastWatchRecord, "updatedAt"> & { updatedAt?: number }): void {
  if (typeof window === "undefined") return;
  try {
    const episode = Math.max(1, Math.floor(Number(record.episode) || 1));
    const translationId = String(record.translationId || "").trim();
    if (!translationId) return;
    const positionSec = Math.max(0, Math.floor(Number(record.positionSec) || 0));
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const payload: LastWatchRecord = {
      translationId,
      episode,
      positionSec,
      updatedAt: record.updatedAt ?? Date.now(),
      ...(title ? { title } : {}),
    };
    window.localStorage.setItem(lastKey(animeId), JSON.stringify(payload));
  } catch {
    /* */
  }
}

/** Сохранить позицию в серии и «последний просмотр» тайтла. */
/** Все тайтлы с сохранённым прогрессом (для главной). */
export function listContinueWatching(limit = 12): ContinueWatchEntry[] {
  if (typeof window === "undefined") return [];
  const items: ContinueWatchEntry[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(LAST_PREFIX)) continue;
      const animeId = Number(key.slice(LAST_PREFIX.length));
      if (!Number.isFinite(animeId) || animeId <= 0) continue;
      const last = readLastWatch(animeId);
      if (!last) continue;
      if (last.positionSec < MIN_CONTINUE_SEC && last.episode <= 1) continue;

      items.push({
        animeId,
        title: last.title || "",
        translationId: last.translationId,
        episode: last.episode,
        positionSec: last.positionSec,
        updatedAt: last.updatedAt,
        progressLabel: formatResumeHint(last.episode, last.positionSec),
      });
    }
  } catch {
    return [];
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function flushWatchProgress(
  animeId: number,
  translationId: string,
  episode: number,
  currentTimeSec: number,
  durationSec?: number,
  title?: string,
): void {
  const ep = Math.max(1, Math.floor(episode) || 1);
  const tid = String(translationId || "").trim();
  if (!animeId || !tid) return;

  let pos = currentTimeSec;
  if (Number.isFinite(durationSec) && (durationSec as number) > 0 && pos > (durationSec as number) - 5) {
    pos = 0;
    writeResumeSec(animeId, tid, ep, 0);
    writeLastWatch(animeId, { translationId: tid, episode: ep + 1, positionSec: 0, title });
    return;
  }

  if (!Number.isFinite(pos) || pos <= 0.5) {
    writeResumeSec(animeId, tid, ep, 0);
    writeLastWatch(animeId, { translationId: tid, episode: ep, positionSec: 0, title });
    return;
  }

  const sec = Math.floor(pos);
  writeResumeSec(animeId, tid, ep, sec);
  writeLastWatch(animeId, { translationId: tid, episode: ep, positionSec: sec, title });
}

export type LaunchWatch = {
  episode: number;
  translationId: string | null;
  /** Позиция из сохранения (если нет явной серии в URL). */
  savedResumeSec: number | null;
  usedSavedEpisode: boolean;
};

/**
 * Старт по ссылке: если в URL нет `episode`, подставляем последнюю серию и позицию.
 */
export function resolveLaunchWatch(
  animeId: number,
  opts: {
    explicitEpisode: boolean;
    urlEpisode?: number;
    urlTranslationId?: string | null;
  },
): LaunchWatch {
  const urlEp =
    opts.urlEpisode != null && Number.isFinite(opts.urlEpisode) && opts.urlEpisode > 0
      ? Math.floor(opts.urlEpisode)
      : 1;

  if (opts.explicitEpisode) {
    const tid = opts.urlTranslationId?.trim() || null;
    const resume =
      tid && animeId > 0 ? readResumeSec(animeId, tid, urlEp) : null;
    return {
      episode: urlEp,
      translationId: tid,
      savedResumeSec: resume,
      usedSavedEpisode: false,
    };
  }

  const last = readLastWatch(animeId);
  if (last) {
    const tid = opts.urlTranslationId?.trim() || last.translationId;
    const perEp = tid ? readResumeSec(animeId, tid, last.episode) : null;
    const resume = perEp ?? (last.positionSec > 0.5 ? last.positionSec : null);
    return {
      episode: last.episode,
      translationId: tid || null,
      savedResumeSec: resume,
      usedSavedEpisode: true,
    };
  }

  const tid = opts.urlTranslationId?.trim() || null;
  const resume = tid && animeId > 0 ? readResumeSec(animeId, tid, urlEp) : null;
  return {
    episode: urlEp,
    translationId: tid,
    savedResumeSec: resume,
    usedSavedEpisode: false,
  };
}
