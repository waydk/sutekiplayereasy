import { proxifyMediaUrl } from "./kodikUtils";

/** Сколько секунд «мгновенно» буферизуем в приоритете перед остальным файлом. */
export const INSTANT_PLAY_WINDOW_SEC = 60;

const HEAD_BYTES_CAP = 10_000_000;

/** Оценка байт для N секунд (битрейт в kbps). */
export function estimateHeadBytes(seconds: number, kbps = 2800): number {
  return Math.min(HEAD_BYTES_CAP, Math.ceil((kbps * 1000 * seconds) / 8));
}

/**
 * Range-запрос первых ~60 с MP4 — прогревает CDN/кэш, <video> стартует быстрее.
 * Не блокирует UI: fire-and-forget.
 */
export function warmMp4HeadWindow(
  mp4Url: string,
  opts?: { seconds?: number; kbps?: number; direct?: boolean; lite?: boolean },
): void {
  if (typeof fetch === "undefined") return;
  const raw = String(mp4Url || "").trim();
  if (!raw.startsWith("http")) return;
  const lite = opts?.lite ?? false;
  const seconds = opts?.seconds ?? (lite ? 14 : INSTANT_PLAY_WINDOW_SEC);
  const bytes = estimateHeadBytes(seconds, opts?.kbps ?? (lite ? 1600 : 2800));
  const href = proxifyMediaUrl(raw, { direct: opts?.direct ?? true });
  void fetch(href, {
    method: "GET",
    headers: { Range: `bytes=0-${bytes - 1}` },
    credentials: "omit",
    cache: "force-cache",
    mode: "cors",
  }).catch(() => {
    /* best-effort */
  });
}

/** После старта воспроизведения расширяем буфер hls.js (сначала ~1 мин, потом весь эпизод). */
export function expandHlsBufferAfterPlay(hls: {
  config: { maxBufferLength: number; maxMaxBufferLength: number };
}): void {
  hls.config.maxBufferLength = 120;
  hls.config.maxMaxBufferLength = 600;
}

export const HLS_INSTANT_START_OPTIONS = {
  startFragPrefetch: true,
  /** Сначала копим ~1 минуту, потом expandHlsBufferAfterPlay. */
  maxBufferLength: 55,
  maxMaxBufferLength: 65,
  backBufferLength: 30,
} as const;
