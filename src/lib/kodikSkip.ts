/**
 * Пропуск OP/ED: только при явных таймкодах из API /kodik/link (или совместимых полей).
 * Фиксированные сдвиги без данных Kodik не используются — см. ответ бэкенда.
 */

export const KODIK_SKIP_SEEK = {
  /** Не уезжать за конец дорожки (сек). */
  edgeEpsilonSec: 0.05,
} as const;

export type KodikSkipMarkers = {
  /** Конец опенинга: куда перемотать по «Пропустить опенинг» (сек от начала). */
  openingEndSec: number | null;
  /** Начало эндинга: для «Пропустить эндинг» — обычно прыжок к концу ролика (если задано). */
  endingStartSec: number | null;
  /** Явная цель после пропуска эндинга (сек), если API отдаёт отдельно. */
  endingSkipToSec: number | null;
};

function readFiniteNonNeg(o: Record<string, unknown>, key: string): number | null {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/**
 * Разбор опциональных полей из ответа `/api/v1/anime/.../kodik/link`.
 * Дублируем возможные имена полей на будущее, когда бэкенд начнёт их проксировать.
 */
export function pickSkipMarkersFromKodikLink(out: unknown): KodikSkipMarkers {
  if (!out || typeof out !== "object") {
    return { openingEndSec: null, endingStartSec: null, endingSkipToSec: null };
  }
  const o = out as Record<string, unknown>;

  const openingEndSec =
    readFiniteNonNeg(o, "opening_end_sec") ??
    readFiniteNonNeg(o, "op_end_sec") ??
    readFiniteNonNeg(o, "skip_opening_to_sec");

  const endingStartSec =
    readFiniteNonNeg(o, "ending_start_sec") ??
    readFiniteNonNeg(o, "ed_start_sec") ??
    readFiniteNonNeg(o, "ending_credits_start_sec");

  const endingSkipToSec =
    readFiniteNonNeg(o, "ending_skip_to_sec") ??
    readFiniteNonNeg(o, "skip_ending_to_sec");

  return { openingEndSec, endingStartSec, endingSkipToSec };
}

/** Конец воспроизводимого интервала (duration или seekable), иначе null. */
export function getPlayableEndSec(video: HTMLVideoElement): number | null {
  const d = video.duration;
  if (Number.isFinite(d) && d > 0 && !Number.isNaN(d)) return d;
  try {
    const sb = video.seekable;
    if (sb && sb.length > 0) {
      const end = sb.end(sb.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* */
  }
  return null;
}

export function clampSeekSec(video: HTMLVideoElement, t: number, epsilon = KODIK_SKIP_SEEK.edgeEpsilonSec): number {
  const end = getPlayableEndSec(video);
  const lo = 0;
  const hi = end != null ? Math.max(lo, end - epsilon) : t;
  return Math.max(lo, Math.min(t, hi));
}

export function seekVideoToSec(video: HTMLVideoElement, t: number): void {
  try {
    video.currentTime = clampSeekSec(video, t);
  } catch {
    /* */
  }
}

export function hasAnySkipMarker(m: KodikSkipMarkers | null): boolean {
  if (!m) return false;
  return (
    m.openingEndSec != null ||
    m.endingStartSec != null ||
    m.endingSkipToSec != null
  );
}
