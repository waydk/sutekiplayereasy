import {
  canPlayNativeHls,
  getStartupNetworkHints,
  pickKodikMp4Quality,
  shouldAutoplayMuted,
  shouldDirectMp4Url,
  shouldMp4FirstStart,
  shouldTryHlsStart,
} from "./startupPolicy";
import {
  linkCache,
  cacheSet,
  CACHE_TTL_LINK_MS,
  preconnectMediaOrigin,
  preloadMp4Url,
  takeWarmBootstrap,
  type KodikLinkResponse,
} from "./playerCache";
import { pickSkipMarkersFromKodikLink, seekVideoToSec, shouldAutoSkipOpening } from "./kodikSkip";
import { warmMp4HeadWindow } from "./progressiveBuffer";
import { proxifyMediaUrl, replaceQualityInUrl, resolveHlsManifestUrl } from "./kodikUtils";
import type { PlayerBootstrapResponse } from "./playerApi";

type BootWindow = {
  params?: { animeId: number; translationId: string | null; episode: number };
  bootstrap?: Promise<PlayerBootstrapResponse>;
};

function linkFromBootstrap(data: PlayerBootstrapResponse | null | undefined): {
  link: KodikLinkResponse;
  tid: string;
} | null {
  if (!data?.link || typeof data.link !== "object") return null;
  const srv = data.link as KodikLinkResponse & { unavailable?: boolean };
  if (srv.unavailable) return null;
  const url = typeof srv.player_url === "string" ? srv.player_url.trim() : "";
  if (!url) return null;
  const tid = String(data.translation_id ?? "").trim();
  if (!tid) return null;
  return { link: srv, tid };
}

export type EarlyVideoStartHooks = {
  onFirstFrame?: () => void;
  onAutoplayBlocked?: () => void;
};

function autoplayVideo(video: HTMLVideoElement, hooks?: EarlyVideoStartHooks): void {
  const markFrame = () => hooks?.onFirstFrame?.();
  const run = (muted: boolean) => {
    video.muted = muted;
    void video
      .play()
      .then(() => {
        if (muted && shouldAutoplayMuted()) video.muted = false;
        markFrame();
      })
      .catch(() => {
        if (muted) {
          void video.play().catch(() => hooks?.onAutoplayBlocked?.());
          return;
        }
        hooks?.onAutoplayBlocked?.();
      });
  };
  if (shouldAutoplayMuted()) run(true);
  else run(video.muted);
}

/** Старт до React bootstrap: head-prefetch / warm cache. */
export function tryEarlyVideoStart(
  video: HTMLVideoElement | null,
  animeId: number,
  translationId: string | null,
  episode: number,
  inTelegram: boolean,
  hooks?: EarlyVideoStartHooks,
): boolean {
  if (!video || animeId <= 0) return false;

  const net = getStartupNetworkHints();
  const direct = shouldDirectMp4Url(inTelegram);
  const mp4First = shouldMp4FirstStart(inTelegram, net);

  const apply = (pack: { link: KodikLinkResponse; tid: string }) => {
    const hlsRaw = typeof pack.link.hls_manifest_url === "string" ? pack.link.hls_manifest_url.trim() : "";
    const tryNativeHls = inTelegram && canPlayNativeHls() && shouldTryHlsStart(hlsRaw, mp4First);

    if (tryNativeHls) {
      const manifestSrc = resolveHlsManifestUrl(hlsRaw);
      preconnectMediaOrigin(manifestSrc);
      cacheSet(linkCache, `${animeId}:${pack.tid}:${episode}`, pack.link, CACHE_TTL_LINK_MS);
      video.pause();
      video.src = manifestSrc;
      video.load();
      const markers = pickSkipMarkersFromKodikLink(pack.link);
      let frameDone = false;
      const markFrame = () => {
        if (frameDone) return;
        frameDone = true;
        hooks?.onFirstFrame?.();
      };
      video.addEventListener("loadeddata", markFrame, { once: true });
      video.addEventListener("playing", markFrame, { once: true });
      const tryPlay = () => {
        autoplayVideo(video, hooks);
        if (shouldAutoSkipOpening(markers, null, video.currentTime)) {
          seekVideoToSec(video, markers.openingEndSec!);
        }
      };
      if (video.readyState >= 2) tryPlay();
      else video.addEventListener("loadedmetadata", tryPlay, { once: true });
      return true;
    }

    const q = pickKodikMp4Quality(pack.link, net);
    const mp4 = replaceQualityInUrl(String(pack.link.player_url || "").trim(), q);
    if (!mp4) return false;
    preconnectMediaOrigin(mp4);
    preloadMp4Url(mp4);
    warmMp4HeadWindow(mp4, { direct, lite: inTelegram });
    const markers = pickSkipMarkersFromKodikLink(pack.link);
    cacheSet(linkCache, `${animeId}:${pack.tid}:${episode}`, pack.link, CACHE_TTL_LINK_MS);
    video.pause();
    video.src = proxifyMediaUrl(mp4, { direct });
    video.load();
    let frameDone = false;
    const markFrame = () => {
      if (frameDone) return;
      frameDone = true;
      hooks?.onFirstFrame?.();
    };
    video.addEventListener("loadeddata", markFrame, { once: true });
    video.addEventListener("playing", markFrame, { once: true });
    const tryPlay = () => {
      autoplayVideo(video, hooks);
      const onSkip = () => {
        if (shouldAutoSkipOpening(markers, null, video.currentTime)) {
          seekVideoToSec(video, markers.openingEndSec!);
        }
      };
      video.addEventListener("playing", onSkip, { once: true });
    };
    if (video.readyState >= 2) tryPlay();
    else video.addEventListener("loadeddata", tryPlay, { once: true });
    return true;
  };

  const cached = takeWarmBootstrap(animeId, translationId, episode);
  const fromCache = linkFromBootstrap(cached);
  if (fromCache) return apply(fromCache);

  if (typeof window === "undefined") return false;
  const boot = (window as unknown as { __sutekiBoot__?: BootWindow }).__sutekiBoot__;
  if (!boot?.bootstrap || !boot.params) return false;
  const p = boot.params;
  const tidA = (p.translationId ?? "").trim();
  const tidB = (translationId ?? "").trim();
  if (p.animeId !== animeId || p.episode !== episode) return false;
  if (tidA && tidB && tidA !== tidB) return false;

  void boot.bootstrap.then((data) => {
    const pack = linkFromBootstrap(data);
    if (pack) apply(pack);
  });
  return false;
}
