import { inferQualityFromUrl } from "./kodikUtils";
import { isTelegramWebApp } from "../telegramWebApp";

export type StartupNetworkHints = {
  abrEstimate: number;
  maxStartHeight: number | null;
  label: string;
};

const HLS_DEFAULT_ABR = 12_000_000;

/** Заголовок/query `client` для API: быстрый link без CDN HEAD на TG/iOS. */
export function getSutekiApiClient(): "tg" | "ios" | "mobile" | null {
  if (isTelegramWebApp()) return "tg";
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (isMobileStartup()) return "mobile";
  return null;
}

export function isIosWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

export function isMobileStartup(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isTelegramWebApp()) return true;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && window.matchMedia?.("(max-width: 900px)").matches) return true;
  return false;
}

export function getStartupNetworkHints(): StartupNetworkHints {
  if (typeof navigator === "undefined") {
    return { abrEstimate: HLS_DEFAULT_ABR, maxStartHeight: null, label: "server" };
  }
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  };
  const conn = nav.connection;
  if (isTelegramWebApp()) {
    const effective = String(conn?.effectiveType || "").toLowerCase();
    const saveData = Boolean(conn?.saveData);
    if (saveData || effective.includes("2g") || effective === "slow-2g") {
      return { abrEstimate: 1_200_000, maxStartHeight: 360, label: "tg-2g" };
    }
    return { abrEstimate: HLS_DEFAULT_ABR, maxStartHeight: null, label: "tg" };
  }
  if (!conn) return { abrEstimate: HLS_DEFAULT_ABR, maxStartHeight: null, label: "unknown" };
  const effective = String(conn.effectiveType || "").toLowerCase();
  const downlink = Number(conn.downlink || 0);
  const saveData = Boolean(conn.saveData);
  if (saveData || effective.includes("2g") || effective === "slow-2g") {
    return { abrEstimate: 1_200_000, maxStartHeight: 360, label: saveData ? "save-data" : "2g" };
  }
  if (effective === "3g" || (downlink > 0 && downlink < 2.5)) {
    return { abrEstimate: 2_500_000, maxStartHeight: 480, label: "3g" };
  }
  if (effective === "4g" && downlink > 0 && downlink < 6) {
    return { abrEstimate: 5_000_000, maxStartHeight: 720, label: "4g-mid" };
  }
  return { abrEstimate: HLS_DEFAULT_ABR, maxStartHeight: null, label: effective || "default" };
}

export type StartupMode = "MP4" | "HLS" | "HLS(native)" | "mini-fast";

export type StartupTrace = {
  bootstrapMs: number;
  linkMs: number;
  manifestMs: number;
  firstFrameMs: number;
  firstPlayMs: number;
  mode: StartupMode;
  net: string;
  client: "tg" | "mobile" | "desktop";
  fallback?: string;
  autoplayBlocked?: boolean;
};

export function startupClientLabel(inTelegram: boolean): StartupTrace["client"] {
  if (inTelegram) return "tg";
  if (isMobileStartup()) return "mobile";
  return "desktop";
}

/** Safari/iOS (в т.ч. Telegram WebView): нативный HLS без hls.js — как на desktop. */
export function canPlayNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return (
    v.canPlayType("application/vnd.apple.mpegurl") !== "" ||
    v.canPlayType("application/x-mpegURL") !== ""
  );
}

/** Mini App: тот же путь, что desktop (HLS), не принудительный MP4 — MP4 только если HLS недоступен. */
export function shouldMp4FirstStart(inTelegram: boolean, _net: StartupNetworkHints): boolean {
  if (!inTelegram) return false;
  if (canPlayNativeHls()) return false;
  return false;
}

/** Подгружаем hls.js и в TG (если понадобится fallback без native HLS). */
export function shouldPreloadHlsJs(_inTelegram: boolean): boolean {
  return true;
}

/** HLS если есть manifest (не только prefer_hls / /s/m/). */
export function shouldTryHlsStart(hlsRaw: string, mp4FirstMode: boolean): boolean {
  return Boolean(hlsRaw.trim()) && !mp4FirstMode;
}

/** <video src> не требует CORS — прямой CDN быстрее hop через Vercel proxy. */
export function shouldDirectMp4Url(inTelegram = false): boolean {
  if (import.meta.env.VITE_DIRECT_MP4 === "0" && !inTelegram) return false;
  /* В TG WebView прямой CDN обычно стабильнее и без лишнего hop на Edge. */
  if (inTelegram) return true;
  return import.meta.env.VITE_DIRECT_MP4 !== "0";
}

function isSlowStartupNet(net: StartupNetworkHints): boolean {
  return (
    net.label === "tg-2g" ||
    net.label === "save-data" ||
    net.label === "2g" ||
    net.label === "slow-2g"
  );
}

/** Максимальное MP4-качество из ответа Kodik (kodik_max_quality + URL), без искусственного 480p. */
export function pickKodikMp4Quality(
  link: { kodik_max_quality?: number | null; player_url?: string } | null | undefined,
  net: StartupNetworkHints,
): number {
  if (isSlowStartupNet(net)) {
    const mq = Number(link?.kodik_max_quality) || 0;
    return mq >= 360 ? 360 : 360;
  }
  const fromUrl = inferQualityFromUrl(String(link?.player_url || ""));
  const mq = Number(link?.kodik_max_quality) || 0;
  let q = fromUrl || mq || 720;
  if (fromUrl) q = Math.max(q, fromUrl);
  if (mq > 0) q = Math.max(q, mq);
  return Math.min(720, Math.max(360, Math.floor(q)));
}

/** @deprecated используйте pickKodikMp4Quality с объектом link */
export function startupMp4Quality(
  net: StartupNetworkHints,
  _inTelegram = false,
  link?: { kodik_max_quality?: number | null; player_url?: string } | null,
): number {
  return pickKodikMp4Quality(link ?? null, net);
}

/** iOS/TG WebView: autoplay только в muted; после старта можно включить звук. */
export function shouldAutoplayMuted(): boolean {
  if (typeof navigator === "undefined") return false;
  return isTelegramWebApp() || isMobileStartup() || isIosWebKit();
}

export function firstFrameWatchdogMs(inTelegram: boolean): number {
  return inTelegram ? 12_000 : 18_000;
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatStartupTrace(t: StartupTrace): string {
  const parts = [
    `mode=${t.mode}`,
    `bootstrap=${fmtMs(t.bootstrapMs)}`,
    `link=${fmtMs(t.linkMs)}`,
  ];
  if (t.manifestMs > 0) parts.push(`manifest=${fmtMs(t.manifestMs)}`);
  if (t.firstFrameMs > 0) parts.push(`frame=${fmtMs(t.firstFrameMs)}`);
  if (t.firstPlayMs > 0) parts.push(`play=${fmtMs(t.firstPlayMs)}`);
  parts.push(`net=${t.net}`, `client=${t.client}`);
  if (t.fallback) parts.push(`fallback=${t.fallback}`);
  if (t.autoplayBlocked) parts.push("autoplay=blocked");
  return parts.join(" · ");
}

export function logStartupTrace(t: StartupTrace): void {
  const line = formatStartupTrace(t);
  console.log("[startup]", line, t);
}
