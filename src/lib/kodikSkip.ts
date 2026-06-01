/**
 * Пропуск OP/ED: только при явных таймкодах из API /kodik/link (или совместимых полей).
 * Фиксированные сдвиги без данных Kodik не используются — см. ответ бэкенда.
 */

export const KODIK_SKIP_SEEK = {
  /** Шаг перемотки (клавиатура Shift+←/→, Plyr seekTime). */
  seekStepSec: 5,
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

/** Диапазон, в который браузер реально разрешает seek (HLS часто растёт по мере буфера). */
export function getSeekableRange(video: HTMLVideoElement): { start: number; end: number } | null {
  try {
    const sb = video.seekable;
    if (!sb || sb.length === 0) return null;
    const start = sb.start(0);
    const end = sb.end(sb.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start: Math.max(0, start), end };
  } catch {
    return null;
  }
}

function isUsableMediaDuration(d: number): boolean {
  return Number.isFinite(d) && d > 0 && !Number.isNaN(d) && d < 2 ** 32 && d !== Number.POSITIVE_INFINITY;
}

/** Начало допустимой перемотки (обычно 0; для HLS — seekable.start). */
export function getPlayableStartSec(video: HTMLVideoElement): number {
  return getSeekableRange(video)?.start ?? 0;
}

/** Конец воспроизводимого интервала (min(duration, seekable.end)), иначе null. */
export function getPlayableEndSec(video: HTMLVideoElement): number | null {
  const range = getSeekableRange(video);
  const d = video.duration;
  const durEnd = isUsableMediaDuration(d) ? d : null;
  if (range && durEnd != null) return Math.min(range.end, durEnd);
  if (range) return range.end;
  return durEnd;
}

/** Длительность для UI (Plyr): реальный конец таймлайна, не меньше текущей позиции. */
export function resolveMediaDurationSec(video: HTMLVideoElement): number | null {
  const end = getPlayableEndSec(video);
  if (end == null) return null;
  const cur = video.currentTime;
  const duration = Number.isFinite(cur) && cur > end ? cur : end;
  return duration > 0.05 ? duration : null;
}

export function clampSeekSec(video: HTMLVideoElement, t: number, epsilon = KODIK_SKIP_SEEK.edgeEpsilonSec): number {
  const lo = getPlayableStartSec(video);
  const end = getPlayableEndSec(video);
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

/** Относительная перемотка на `deltaSec` (отрицательная — назад). */
export function seekVideoByDelta(video: HTMLVideoElement, deltaSec: number): void {
  const cur = video.currentTime;
  if (!Number.isFinite(cur) || !Number.isFinite(deltaSec)) return;
  seekVideoToSec(video, cur + deltaSec);
}

/** Автопропуск OP один раз за эпизод (если Kodik отдал таймкод и нет resume позже OP). */
export function shouldAutoSkipOpening(
  markers: KodikSkipMarkers | null,
  resumeSec: number | null,
  currentTimeSec: number,
): boolean {
  const target = markers?.openingEndSec;
  if (target == null || target <= 0.5) return false;
  if (resumeSec != null && resumeSec > target + 0.5) return false;
  return currentTimeSec < target - 0.35;
}

export function hasAnySkipMarker(m: KodikSkipMarkers | null): boolean {
  if (!m) return false;
  return (
    m.openingEndSec != null ||
    m.endingStartSec != null ||
    m.endingSkipToSec != null
  );
}

/** Есть таймкоды эндинга для кнопки «Следующая серия» в плеере. */
export function hasEndingSkipMarkers(m: KodikSkipMarkers | null): boolean {
  if (!m) return false;
  return m.endingStartSec != null || m.endingSkipToSec != null;
}

/** Текущая позиция в сегменте эндинга (как для «Пропустить ED»). */
export function isInEndingSegment(markers: KodikSkipMarkers | null, currentTimeSec: number): boolean {
  if (!markers || !Number.isFinite(currentTimeSec)) return false;
  const start = markers.endingStartSec;
  if (start != null) return currentTimeSec >= start - 0.35;
  const skipTo = markers.endingSkipToSec;
  if (skipTo != null) return currentTimeSec >= Math.max(0, skipTo - 180);
  return false;
}
