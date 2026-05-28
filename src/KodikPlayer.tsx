import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import type Plyr from "plyr";
import { usePlayerSearchFocus } from "./hooks/usePlayerSearchFocus";
import { useTelegramWebApp } from "./hooks/useTelegramWebApp";
import { useSearchParams } from "./hooks/useSearchParams";
import { pushLaunchShikiId } from "./hooks/useLaunchShikiId";
import { isTelegramWebApp, parseLaunchShikiId } from "./telegramWebApp";
import { shouldShowDebugPanel, shouldShowStartupTrace } from "./lib/showDebug";
import {
  bootstrapCache,
  cacheGet,
  cacheSet,
  CACHE_TTL_BOOTSTRAP_MS,
  CACHE_TTL_EPISODES_MS,
  CACHE_TTL_LINK_MS,
  linkCache,
  preconnectMediaOrigin,
  warmBootstrap,
  type CacheEntry,
  type KodikLinkResponse,
} from "./lib/playerCache";
import { preloadMp4Url } from "./lib/playerCache";
import { tryEarlyVideoStart } from "./lib/earlyVideoStart";
import {
  canPlayNativeHls,
  firstFrameWatchdogMs,
  formatStartupTrace,
  getStartupNetworkHints,
  getSutekiApiClient,
  isMobileStartup,
  logStartupTrace,
  pickKodikMp4Quality,
  shouldAutoplayMuted,
  shouldDirectMp4Url,
  shouldMp4FirstStart,
  shouldPreloadHlsJs,
  shouldTryHlsStart,
  startupClientLabel,
  type StartupMode,
  type StartupTrace,
} from "./lib/startupPolicy";
import { fetchKodikSkipMarkersAsync } from "./lib/kodikSkipFetch";
import { formatApiError, formatVideoError, tgHaptic } from "./lib/userMessages";
import {
  availableQualities,
  buildEpisodesOptions,
  buildKodikEpisodesPayloadFromWatch,
  formatTranslationLabel,
  inferQualityFromUrl,
  pickFirstTranslationId,
  pickTranslationForEpisode,
  proxifyMediaUrl,
  resolveHlsManifestUrl,
  replaceQualityInUrl,
  translationHasSeriesRangeForTranslationId,
  translationRowHasId,
  translationRowIdString,
  type TranslationRow,
} from "./lib/kodikUtils";
import {
  getPlayableEndSec,
  hasAnySkipMarker,
  KODIK_SKIP_SEEK,
  pickSkipMarkersFromKodikLink,
  seekVideoToSec,
  shouldAutoSkipOpening,
  type KodikSkipMarkers,
} from "./lib/kodikSkip";
import {
  expandHlsBufferAfterPlay,
  HLS_INSTANT_START_OPTIONS,
  warmMp4HeadWindow,
} from "./lib/progressiveBuffer";
import { hubApiUrl, playerBootstrapUrl, type PlayerBootstrapResponse } from "./lib/playerApi";
import { PLYR_QUALITY_CONFIG, syncPlyrQualityMenu } from "./lib/plyrQualitySync";
import {
  PLAYER_WAIT_GIF_DEFAULT,
  WAIT_PHRASES_BUFFER,
  WAIT_PHRASES_LOADER,
} from "./lib/waitPhrases";
import {
  flushWatchProgress,
  formatClockSec,
  formatResumeHint,
  readResumeSec,
  resolveLaunchWatch,
  writeResumeSec,
} from "./lib/watchProgress";
import {
  normalizeSearchQuery,
  searchAnime,
  SEARCH_DEBOUNCE_MS,
  type AnimeSearchRow,
} from "./lib/animeSearch";

type WatchPayload = {
  player_url?: string;
  translations?: TranslationRow[];
  series_count?: number;
  unavailable_reason?: string;
  message?: string;
};

type EpisodesPayload = Parameters<typeof buildEpisodesOptions>[0];

/** Сколько раз подряд перезапросить /kodik/link при протухшем CDN (MediaError 2/4). */
const MAX_STALE_LINK_MEDIA_RETRIES = 2;
const STALE_LINK_MEDIA_ERROR_CODES = new Set([2, 4]);

type PlayStreamOptions = {
  animeId: number;
  translationId: string;
  episode: number;
  resumeAfterLoadSec?: number | null;
  /** Позиция из «последний просмотр», если нет отдельного ключа по серии. */
  savedResumeSec?: number | null;
  preloaded?: KodikLinkResponse | null;
  bootstrapMs?: number;
  /** true = этот вызов уже ретрай после ошибки источника; не сбрасывать счётчик. */
  staleLinkRetry?: boolean;
  /** После ошибки HLS — сразу MP4 (свежий /kodik/link). */
  forceMp4?: boolean;
};

const TV_KINDS = new Set(["tv", "tv_special", "tv_13", "tv_24", "tv_48"]);
function isTvChronologyKind(kind: string | null | undefined): boolean {
  const raw = String(kind || "").trim().toLowerCase();
  if (!raw) return false;
  const normalized = raw.replace(/\s+/g, "_");
  if (TV_KINDS.has(normalized)) return true;
  // Shikimori/прокси иногда отдают вид типа "TV сериал", "TV series", "tv-24".
  if (raw.startsWith("tv")) return true;
  if (/\btv\b/.test(raw)) return true;
  return false;
}

type ChronologyItem = {
  anime_id: number;
  title: string;
  original_title?: string | null;
  poster?: string | null;
  kind?: string | null;
  year?: number | null;
  date?: string | null;
};

/** Обновить URL без reload — deep link / refresh совпадают с выбранным тайтлом. */
function replaceUrlAnime(animeId: number, episode = 1, translationId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("shiki_id", String(animeId));
    u.searchParams.set("episode", String(Math.max(1, episode)));
    const tid = (translationId ?? "").trim();
    if (tid) u.searchParams.set("translation_id", tid);
    else u.searchParams.delete("translation_id");
    window.history.replaceState(window.history.state, "", u);
  } catch {
    /* */
  }
}

/**
 * hls.js tuning for VOD over proxied Kodik segments.
 * Балансируем «быстрый старт» и «выживание на флапающем CDN».
 * Слишком короткие timeouts → лишние fallback на MP4, который тоже может тупить.
 */
const HLS_VOD_OPTIONS = {
  enableWorker: true,
  lowLatencyMode: false,
  startFragPrefetch: true,
  capLevelToPlayerSize: false,
  maxBufferLength: 3,
  maxMaxBufferLength: 20,
  backBufferLength: 8,
  abrEwmaDefaultEstimate: 12_000_000,
  testBandwidth: false,
  startLevel: -1,
  manifestLoadingTimeOut: 6000,
  manifestLoadingMaxRetry: 2,
  fragLoadingTimeOut: 8000,
  fragLoadingMaxRetry: 3,
  levelLoadingTimeOut: 5000,
} as const;
const HLS_START_WATCHDOG_MS = 4500;
const HLS_START_WATCHDOG_RESUME_MS = 12_000;
/** recoverMediaError / startLoad перед fallback на MP4 или refresh link. */
const HLS_RECOVER_MAX = 2;
const API_FETCH_TIMEOUT_MS = 9000;
const API_FETCH_TIMEOUT_TG_MS = 5500;
const API_RETRY_MAX_ATTEMPTS = 2;
const API_RETRY_MAX_ATTEMPTS_TG = 1;
const API_RETRY_BASE_MS = 260;

function pickInitialHlsLevelIdx(
  pick: { heights: number[]; levelIdxs: number[] },
  maxStartHeight: number | null,
): number | null {
  if (!pick.levelIdxs.length) return null;
  if (maxStartHeight == null) return pick.levelIdxs[pick.levelIdxs.length - 1] ?? null;
  for (let i = 0; i < pick.heights.length; i += 1) {
    if (pick.heights[i] <= maxStartHeight) return pick.levelIdxs[i] ?? null;
  }
  return pick.levelIdxs[pick.levelIdxs.length - 1] ?? null;
}

function playVideoAsap(
  v: HTMLVideoElement,
  resumeSec: number | null,
  hooks?: {
    onAutoplayBlocked?: () => void;
    onFirstFrame?: () => void;
    onFirstPlay?: () => void;
  },
  opts?: { tryMutedAutoplay?: boolean; unmuteAfterAutoplay?: boolean },
) {
  if (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    v.setAttribute("playsinline", "true");
    v.playsInline = true;
  }
  let frameMarked = false;
  let playMarked = false;
  const markFrame = () => {
    if (frameMarked) return;
    frameMarked = true;
    hooks?.onFirstFrame?.();
  };
  const markPlay = () => {
    if (playMarked) return;
    playMarked = true;
    hooks?.onFirstPlay?.();
  };
  const applyResume = () => {
    if (resumeSec == null || resumeSec <= 0.25) return;
    try {
      const d = v.duration;
      const target =
        Number.isFinite(d) && d > 0 ? Math.min(resumeSec, Math.max(0, d - 0.25)) : resumeSec;
      if (target > 0.25) v.currentTime = target;
    } catch {
      /* */
    }
  };
  const start = () => {
    applyResume();
    const runPlay = () => {
      void v
        .play()
        .then(() => {
          markPlay();
        })
        .catch(() => hooks?.onAutoplayBlocked?.());
    };
    if (opts?.tryMutedAutoplay) {
      const prevMuted = v.muted;
      v.muted = true;
      void v
        .play()
        .then(() => {
          markPlay();
          if (opts.unmuteAfterAutoplay) v.muted = false;
          else v.muted = prevMuted;
        })
        .catch(() => {
          v.muted = prevMuted;
          runPlay();
        });
      return;
    }
    runPlay();
  };
  v.addEventListener(
    "playing",
    () => {
      markFrame();
      markPlay();
    },
    { once: true },
  );
  const onReady = () => {
    markFrame();
    start();
  };
  if (v.readyState >= 2) onReady();
  else v.addEventListener("loadeddata", onReady, { once: true });
}

/** Best-effort height for HLS variant label when manifest omits `height`. */
function estimateHeightFromHlsLevel(level: {
  height?: number;
  width?: number;
  bitrate?: number;
}): number {
  if (level.height && level.height > 0) return level.height;
  const w = level.width && level.width > 0 ? level.width : 0;
  if (w) return Math.max(144, Math.min(2160, Math.round((w * 9) / 16 / 2) * 2));
  const br = level.bitrate || 0;
  if (br > 0) return Math.max(144, Math.min(2160, Math.round(br / 2_800_000) * 180));
  return 480;
}

/**
 * One UI row per distinct height (best bitrate wins). Maps select index → `hls.levels` index.
 */
function buildHlsQualityPick(levels: Array<{ height?: number; width?: number; bitrate?: number }>): {
  heights: number[];
  levelIdxs: number[];
} {
  if (!levels?.length) return { heights: [480], levelIdxs: [0] };
  const enriched = levels.map((level, idx) => ({
    idx,
    h: estimateHeightFromHlsLevel(level),
    br: level.bitrate || 0,
  }));
  enriched.sort((a, b) => (a.h !== b.h ? b.h - a.h : b.br - a.br));
  const byHeight = new Map<number, { idx: number; br: number }>();
  for (const e of enriched) {
    const cur = byHeight.get(e.h);
    if (!cur || e.br > cur.br) byHeight.set(e.h, { idx: e.idx, br: e.br });
  }
  const sortedHeights = [...byHeight.keys()].sort((a, b) => b - a);
  const levelIdxs = sortedHeights.map((height) => byHeight.get(height)!.idx);
  return { heights: sortedHeights, levelIdxs };
}

export function KodikPlayer() {
  const searchParams = useSearchParams();
  useTelegramWebApp(true);
  const { onSearchFocus, onSearchBlur, dismissSearchKeyboard } = usePlayerSearchFocus();
  const showDebug = shouldShowDebugPanel();
  const showStartupTrace = shouldShowStartupTrace();
  const inTelegram = isTelegramWebApp();
  const [tgLaunchId, setTgLaunchId] = useState<number | null>(() => parseLaunchShikiId());

  useEffect(() => {
    const syncLaunchId = () => {
      const id = parseLaunchShikiId();
      if (id) setTgLaunchId(id);
    };
    syncLaunchId();
    const tg = window.Telegram?.WebApp;
    tg?.onEvent?.("viewportChanged", syncLaunchId);
    return () => tg?.offEvent?.("viewportChanged", syncLaunchId);
  }, []);
  const launchShiki = tgLaunchId;
  const qpAnime = searchParams.get("anime_id") || searchParams.get("shiki_id");
  const parsedAnimeId =
    launchShiki ??
    (qpAnime && !Number.isNaN(Number(qpAnime)) && Number(qpAnime) > 0 ? Math.floor(Number(qpAnime)) : null);
  const qpTid = searchParams.get("translation_id");
  const qpEp = searchParams.get("episode");
  const hasExplicitEpisodeInUrl = searchParams.has("episode");
  const parsedEp =
    qpEp && !Number.isNaN(Number(qpEp)) && Number(qpEp) > 0 ? Math.floor(Number(qpEp)) : 1;
  const launchWatch = useMemo(
    () =>
      parsedAnimeId
        ? resolveLaunchWatch(parsedAnimeId, {
            explicitEpisode: hasExplicitEpisodeInUrl,
            urlEpisode: parsedEp,
            urlTranslationId: qpTid ? String(qpTid) : null,
          })
        : null,
    [parsedAnimeId, hasExplicitEpisodeInUrl, parsedEp, qpTid],
  );

  const defaultQ = searchParams.get("q") || "";

  const [query, setQuery] = useState(defaultQ);
  const [animeId, setAnimeId] = useState<number | null>(parsedAnimeId);
  const [translationId, setTranslationId] = useState<string | null>(
    launchWatch?.translationId ?? (qpTid ? String(qpTid) : null),
  );
  const [episode, setEpisode] = useState(launchWatch?.episode ?? parsedEp);
  const [animeTitle, setAnimeTitle] = useState("");
  const [watch, setWatch] = useState<WatchPayload | null>(null);
  const [episodes, setEpisodes] = useState<EpisodesPayload | null>(null);
  const [trSearch, setTrSearch] = useState("");
  const [rawMp4, setRawMp4] = useState("");
  const [qualityOptions, setQualityOptions] = useState<number[]>([360, 480, 720]);
  const [selectedQuality, setSelectedQuality] = useState<number | "">("");
  const [status, setStatusLine] = useState(() => ({
    text: parsedAnimeId
      ? "загрузка…"
      : "готово. Введите название и нажмите «Найти».",
    error: false,
  }));
  const [endpoint, setEndpoint] = useState("—");
  const [debugJson, setDebugJson] = useState<unknown>("Здесь будут ответы API (debug).");
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<AnimeSearchRow[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [needsPlayTap, setNeedsPlayTap] = useState(false);
  const [hlsMode, setHlsMode] = useState(false);
  /** Safari / native HLS: no hls.js instance — quality control API unavailable. */
  const [hlsNativeQualityLock, setHlsNativeQualityLock] = useState(false);
  const [skipMarkers, setSkipMarkers] = useState<KodikSkipMarkers | null>(null);
  const [playableEndKnown, setPlayableEndKnown] = useState(false);
  const [episodeJumpInput, setEpisodeJumpInput] = useState("");
  const [episodeJumpHint, setEpisodeJumpHint] = useState<{ text: string; error: boolean } | null>(null);
  const [chronology, setChronology] = useState<ChronologyItem[]>([]);
  const [chronologyLoading, setChronologyLoading] = useState(false);
  const [chronologyErr, setChronologyErr] = useState<string | null>(null);
  /** Для блока отладки: позиция в своём плеере (не iframe Kodik). */
  const [playbackDebug, setPlaybackDebug] = useState({
    current: 0,
    duration: Number.NaN,
    paused: true,
  });
  const [startupBreakdown, setStartupBreakdown] = useState("—");
  const [awaitingFirstFrame, setAwaitingFirstFrame] = useState(false);
  const [resumeHintSec, setResumeHintSec] = useState<number | null>(null);
  const [resumeHintEpisode, setResumeHintEpisode] = useState<number | null>(null);

  useEffect(() => {
    if (resumeHintSec == null) return;
    const t = window.setTimeout(() => setResumeHintSec(null), 6000);
    return () => clearTimeout(t);
  }, [resumeHintSec]);

  useEffect(() => {
    if (resumeHintSec == null) return;
    const v = videoRef.current;
    if (!v) return;
    const dismiss = () => setResumeHintSec(null);
    v.addEventListener("playing", dismiss, { once: true });
    v.addEventListener("seeked", dismiss, { once: true });
    return () => {
      v.removeEventListener("playing", dismiss);
      v.removeEventListener("seeked", dismiss);
    };
  }, [resumeHintSec]);

  const waitGifUrl = useMemo(() => {
    const raw = import.meta.env.VITE_PLAYER_WAIT_GIF_URL;
    const s = typeof raw === "string" ? raw.trim() : "";
    return s || PLAYER_WAIT_GIF_DEFAULT;
  }, []);

  const [waitGifFailed, setWaitGifFailed] = useState(false);
  useEffect(() => {
    setWaitGifFailed(false);
  }, [waitGifUrl]);

  const [bufPhraseI, setBufPhraseI] = useState(0);
  useEffect(() => {
    if (!buffering) return;
    setBufPhraseI(0);
    const n = WAIT_PHRASES_BUFFER.length;
    const t = window.setInterval(() => {
      setBufPhraseI((i) => (i + 1) % n);
    }, 2400);
    return () => clearInterval(t);
  }, [buffering]);

  const [loadPhraseI, setLoadPhraseI] = useState(0);
  useEffect(() => {
    const active = (busy || loadingBootstrap || awaitingFirstFrame) && !needsPlayTap;
    if (!active) return;
    setLoadPhraseI(0);
    const n = WAIT_PHRASES_LOADER.length;
    const t = window.setInterval(() => {
      setLoadPhraseI((i) => (i + 1) % n);
    }, 2600);
    return () => clearInterval(t);
  }, [busy, loadingBootstrap, needsPlayTap]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const episodeJumpHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const switchQualityRef = useRef<(q: number) => void>(() => {});
  const hlsRef = useRef<Hls | null>(null);
  const hlsImportRef = useRef<Promise<typeof import("hls.js")> | null>(null);
  const searchReqIdRef = useRef(0);
  const lastDebouncedQueryRef = useRef<string>("");
  const earlyVideoStartedRef = useRef(false);
  const earlyStartTargetRef = useRef<{
    animeId: number;
    translationId: string;
    episode: number;
  } | null>(null);

  function earlyStartMatches(animeId: number, translationId: string, episode: number): boolean {
    const t = earlyStartTargetRef.current;
    if (!earlyVideoStartedRef.current || !t) return false;
    return t.animeId === animeId && t.episode === episode && t.translationId === translationId;
  }
  const openingAutoSkippedRef = useRef(false);
  const playStreamRef = useRef<((opts: PlayStreamOptions) => Promise<void>) | null>(null);
  const loadAnimeAndPlayRef = useRef<
    ((id: number, preferredTid: string | null, ep: number) => Promise<string | null>) | null
  >(null);
  /** Отмена устаревших loadAnimeAndPlay (race URL autoload vs выбор из поиска). */
  const loadAnimeReqIdRef = useRef(0);
  /** Пользователь выбрал другой тайтл — не перезагружать parsedAnimeId из URL. */
  const userPickedAnimeRef = useRef(false);
  const staleLinkRetryCountRef = useRef(0);
  const playReqIdRef = useRef(0);
  const episodesCacheRef = useRef(new Map<string, CacheEntry<EpisodesPayload>>());
  const publishStartupTraceRef = useRef<(partial?: Partial<StartupTrace>) => void>(() => {});
  /** HLS (hls.js): UI heights order + corresponding `hls.levels` indices for switch/sync (updated with manifest). */
  const hlsQualityPickRef = useRef<{ heights: number[]; levelIdxs: number[] }>({
    heights: [],
    levelIdxs: [],
  });

  const ensureHlsPreloaded = useCallback(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.sutekiHlsPreloadRequested = "1";
    }
    if (!hlsImportRef.current) {
      hlsImportRef.current = import("hls.js").then((mod) => {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.sutekiHlsPreloadReady = "1";
        }
        return mod;
      });
    }
    return hlsImportRef.current;
  }, []);

  useEffect(() => {
    if (!shouldPreloadHlsJs(inTelegram)) return;
    if (parsedAnimeId) void ensureHlsPreloaded();
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (
        window as Window & {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback(
        () => {
          void ensureHlsPreloaded();
        },
        { timeout: 2500 },
      );
      return () => {
        if ("cancelIdleCallback" in window) {
          (
            window as Window & {
              cancelIdleCallback: (n: number) => void;
            }
          ).cancelIdleCallback(id);
        }
      };
    }
    const t = setTimeout(() => void ensureHlsPreloaded(), 1200);
    return () => clearTimeout(t);
  }, [ensureHlsPreloaded, inTelegram, parsedAnimeId]);

  const translationsFiltered = useMemo(() => {
    const trs = watch && Array.isArray(watch.translations) ? watch.translations : [];
    const all = trs.filter((t) => translationRowHasId(t));
    const q = trSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (t) =>
        formatTranslationLabel(t).toLowerCase().includes(q) || translationRowIdString(t).includes(q),
    );
  }, [watch, trSearch]);

  const translationsForStrip = useMemo(() => {
    const filtered = translationsFiltered;
    const activeId = translationId ? String(translationId) : "";
    if (!activeId || filtered.some((t) => translationRowIdString(t) === activeId)) return filtered;
    const active = (watch?.translations || []).find((t) => translationRowIdString(t) === activeId);
    return active && translationRowHasId(active) ? [active, ...filtered] : filtered;
  }, [translationsFiltered, translationId, watch]);

  useEffect(() => {
    if (!watch || !Array.isArray(watch.translations)) return;
    const ids = watch.translations.filter((t) => translationRowHasId(t)).map((t) => translationRowIdString(t));
    if (!ids.length) return;
    if (!translationId || !ids.includes(String(translationId))) {
      setTranslationId(ids[0]);
    }
  }, [watch, translationId]);

  // (was) primary + carousel split; now we render one horizontal strip

  const episodeOptions = useMemo(() => {
    const fromPayload = buildEpisodesOptions(episodes);
    if (fromPayload.length > 0) return fromPayload;
    const tid = String(translationId || "").trim();
    if (watch && tid && translationHasSeriesRangeForTranslationId(watch, tid)) {
      return buildEpisodesOptions(buildKodikEpisodesPayloadFromWatch(watch, tid, 24));
    }
    return fromPayload;
  }, [episodes, translationId, watch]);
  const showEpisodesLoading = Boolean(animeId) && episodes === null && !geoBlocked;

  const setStatus = useCallback((text: string, opts?: { error?: boolean }) => {
    setStatusLine({ text, error: opts?.error ?? false });
  }, []);

  const applyDebug = useCallback(
    (obj: unknown) => {
      if (showDebug) {
        try {
          setDebugJson(obj);
        } catch {
          setDebugJson(String(obj));
        }
      }
    },
    [showDebug],
  );

  const resolveApiUrl = useCallback((pathOrUrl: string) => {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
    if (pathOrUrl.startsWith("/api/v1")) return hubApiUrl(pathOrUrl.slice("/api/v1".length) || "/");
    return hubApiUrl(pathOrUrl);
  }, []);

  const apiJson = useCallback(
    async (pathOrUrl: string) => {
      const url = resolveApiUrl(pathOrUrl);
      setEndpoint(url);
      const maxAttempts = inTelegram ? API_RETRY_MAX_ATTEMPTS_TG : API_RETRY_MAX_ATTEMPTS;
      const fetchTimeoutMs = inTelegram ? API_FETCH_TIMEOUT_TG_MS : API_FETCH_TIMEOUT_MS;
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = setTimeout(() => ctrl?.abort(), fetchTimeoutMs);
        try {
          const apiHeaders: Record<string, string> = { Accept: "application/json" };
          const apiClient = getSutekiApiClient();
          if (apiClient) apiHeaders["X-Suteki-Client"] = apiClient;
          const r = await fetch(url, {
            headers: apiHeaders,
            credentials: "same-origin",
            cache: "no-store",
            signal: ctrl?.signal,
          });
          const j = await r.json().catch(() => ({}));
          if (showDebug) console.log("API:", url, j, `attempt=${attempt}`);
          applyDebug(j);
          if (!r.ok) {
            /* Сохраняем HTTP-код в начале сообщения — formatApiError классифицирует по нему. */
            let detailText = "";
            if (j && typeof j === "object" && j !== null && "detail" in j) {
              const d = (j as { detail?: unknown }).detail;
              if (typeof d === "string") detailText = d;
              else if (d && typeof d === "object" && d !== null && "message" in d) {
                detailText = String((d as { message?: string }).message || "");
              }
            }
            const msg = detailText ? `HTTP ${r.status} ${detailText}` : `HTTP ${r.status}`;
            const retryableHttp = r.status === 429 || r.status === 502 || r.status === 504;
            if (retryableHttp && attempt < maxAttempts) {
              const jitter = Math.floor(Math.random() * 120);
              const waitMs = API_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
              if (showDebug) console.warn(`API retry ${attempt}/${maxAttempts - 1}: ${msg}`);
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              continue;
            }
            throw new Error(formatApiError(new Error(msg)));
          }
          return j;
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          const timedOut = err.name === "AbortError";
          const retryable = timedOut || /fetch failed|network|unreachable|timeout/i.test(err.message);
          lastErr = timedOut ? new Error("request_timeout") : err;
          if (retryable && attempt < maxAttempts) {
            const jitter = Math.floor(Math.random() * 120);
            const waitMs = API_RETRY_BASE_MS * 2 ** (attempt - 1) + jitter;
            if (showDebug) console.warn(`API network retry ${attempt}/${maxAttempts - 1}: ${lastErr.message}`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          throw new Error(formatApiError(lastErr));
        } finally {
          clearTimeout(timeoutId);
        }
      }
      throw new Error(formatApiError(lastErr ?? new Error("API request failed")));
    },
    [applyDebug, inTelegram, resolveApiUrl, showDebug],
  );

  useLayoutEffect(() => {
    if (!parsedAnimeId || earlyVideoStartedRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    const launchEp = launchWatch?.episode ?? parsedEp;
    const launchTid = launchWatch?.translationId ?? (qpTid ? String(qpTid) : null);
    const started = tryEarlyVideoStart(v, parsedAnimeId, launchTid, launchEp, inTelegram, {
      onFirstFrame: () => {
        earlyVideoStartedRef.current = true;
        setAwaitingFirstFrame(false);
      },
      onAutoplayBlocked: () => {
        setAwaitingFirstFrame(false);
        setNeedsPlayTap(true);
      },
    });
    if (started) {
      earlyVideoStartedRef.current = true;
      const tid = String(launchTid || "").trim();
      if (tid) {
        earlyStartTargetRef.current = { animeId: parsedAnimeId, translationId: tid, episode: launchEp };
      }
    }
  }, [parsedAnimeId, parsedEp, launchWatch, qpTid, inTelegram]);

  useEffect(() => {
    let cancelled = false;
    const mountPlyr = async () => {
      await import("plyr/dist/plyr.css");
      const mod = await import("plyr");
      if (cancelled || !videoRef.current || plyrRef.current) return;
      plyrRef.current = new mod.default(videoRef.current, {
        controls: [
          "play-large",
          "play",
          "progress",
          "current-time",
          "duration",
          "mute",
          "volume",
          "settings",
          "fullscreen",
        ],
        settings: ["quality", "speed"],
        quality: {
          ...PLYR_QUALITY_CONFIG,
          onChange: (q) => switchQualityRef.current(q),
        },
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
        fullscreen: { enabled: true, fallback: true, iosNative: true, container: ".sh-video-wrap" },
      });
    };
    const deferPlyr = inTelegram || isMobileStartup();
    if (!deferPlyr) {
      void mountPlyr();
      return () => {
        cancelled = true;
      };
    }
    const v = videoRef.current;
    const onPlaying = () => {
      void mountPlyr();
    };
    const fallbackTimer = window.setTimeout(() => void mountPlyr(), 2000);
    if (v) v.addEventListener("playing", onPlaying, { once: true });
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
      if (v) v.removeEventListener("playing", onPlaying);
    };
  }, [inTelegram]);

  useEffect(() => {
    return () => {
      try {
        hlsRef.current?.destroy();
      } catch {
        /* */
      }
      hlsRef.current = null;
      try {
        plyrRef.current?.destroy();
      } catch {
        /* */
      }
      plyrRef.current = null;
    };
  }, []);

  const loadEpisodes = useCallback(
    async (id: number, tid: string) => {
      const key = `${id}:${tid}`;
      const cached = cacheGet(episodesCacheRef.current, key);
      if (cached) {
        setEpisodes(cached);
        return cached;
      }
      setStatus("получаю /episodes (список серий)…");
      const eps = (await apiJson(
        `/api/v1/anime/${encodeURIComponent(id)}/episodes?provider=kodik&translation_id=${encodeURIComponent(tid)}`,
      )) as EpisodesPayload;
      setEpisodes(eps);
      cacheSet(episodesCacheRef.current, key, eps, CACHE_TTL_EPISODES_MS);
      return eps;
    },
    [apiJson, setStatus],
  );

  /** Записываем watch ВСЕГДА — независимо от наличия translation_id. */
  const applyBootstrapWatch = useCallback(
    (w: WatchPayload): { fallbackTid: string | null; blocked: boolean } => {
      setWatch(w);
      if (w?.unavailable_reason === "geo") {
        setStatus("Kodik geo-блокирован для этого тайтла в текущей сети/регионе.", { error: true });
        setGeoBlocked(true);
        return { fallbackTid: null, blocked: true };
      }
      if (w?.unavailable_reason === "not_configured" || w?.unavailable_reason === "init") {
        setGeoBlocked(false);
        const hint =
          typeof w.message === "string" && w.message.trim()
            ? w.message.trim()
            : "Kodik не подключён к этому серверу: озвучки и видео недоступны.";
        setStatus(hint, { error: false });
        setTranslationId(null);
        setEpisodes(null);
        return { fallbackTid: null, blocked: true };
      }
      setGeoBlocked(false);
      return { fallbackTid: pickFirstTranslationId(w), blocked: false };
    },
    [setStatus],
  );

  const applyBootstrapData = useCallback(
    (data: PlayerBootstrapResponse, preferredTid: string | null, ep: number): string | null => {
      const w = data.watch as WatchPayload;
      const title = typeof data.page_title === "string" ? data.page_title.trim() : "";
      if (title) setAnimeTitle(title);
      const { fallbackTid, blocked } = applyBootstrapWatch(w);
      if (blocked) return null;
      const fromServer =
        typeof data.translation_id === "string" && data.translation_id.trim()
          ? data.translation_id.trim()
          : null;
      let tid = fromServer || fallbackTid;
      if (!tid) return null;
      const ids = new Set(
        (w.translations || []).filter((t) => translationRowHasId(t)).map((t) => translationRowIdString(t)),
      );
      if (preferredTid && ids.has(preferredTid)) {
        tid = preferredTid;
      } else {
        const forEp = pickTranslationForEpisode(w, ep);
        if (forEp && ids.has(forEp)) tid = forEp;
      }
      setTranslationId(tid);
      setEpisode(ep);
      if (data.episodes && typeof data.episodes === "object") {
        setEpisodes(data.episodes as EpisodesPayload);
      } else if (translationHasSeriesRangeForTranslationId(w, tid)) {
        setEpisodes(buildKodikEpisodesPayloadFromWatch(w, tid, 12));
      }
      return tid;
    },
    [applyBootstrapWatch],
  );

  /** Dedup in-flight /kodik/link, чтобы быстрые клики не плодили дубликаты запросов. */
  const linkInflightRef = useRef<Map<string, Promise<KodikLinkResponse | null>>>(new Map());
  const fetchKodikLinkQuiet = useCallback(
    async (id: number, tid: string, ep: number): Promise<KodikLinkResponse | null> => {
      const key = `${id}:${tid}:${ep}`;
      const cached = cacheGet(linkCache, key);
      if (cached?.player_url) return cached;
      const inflight = linkInflightRef.current.get(key);
      if (inflight) return inflight;
      const p = (async () => {
        try {
          const clientQ = getSutekiApiClient();
          const linkPath = `/api/v1/anime/${encodeURIComponent(id)}/kodik/link?episode=${encodeURIComponent(ep)}&translation_id=${encodeURIComponent(tid)}${clientQ ? `&client=${encodeURIComponent(clientQ)}` : ""}`;
          const out = (await apiJson(linkPath)) as KodikLinkResponse;
          if (out?.player_url) cacheSet(linkCache, key, out, CACHE_TTL_LINK_MS);
          return out;
        } catch {
          return null;
        } finally {
          linkInflightRef.current.delete(key);
        }
      })();
      linkInflightRef.current.set(key, p);
      return p;
    },
    [apiJson],
  );

  /** Один быстрый запрос bootstrap (без /kodik/link). */
  const bootstrapAnime = useCallback(
    async (id: number, preferredTid: string | null, ep = 1): Promise<string | null> => {
      setLoadingBootstrap(true);
      setBusy(true);
      setGeoBlocked(false);
      try {
        setStatus("загрузка…");
        const data = (await apiJson(
          playerBootstrapUrl(id, {
            translationId: preferredTid,
            episode: ep,
            includeLink: false,
          }),
        )) as PlayerBootstrapResponse;
        const tid = applyBootstrapData(data, preferredTid, ep);
        if (!tid) return null;
        setStatus("готово: озвучки и серии загружены.");
        return tid;
      } catch (e) {
        console.error(e);
        setStatus(`Ошибка загрузки: ${String(e instanceof Error ? e.message : e)}`, { error: true });
        return null;
      } finally {
        setLoadingBootstrap(false);
        setBusy(false);
      }
    },
    [apiJson, applyBootstrapData, setStatus],
  );

  const destroyHls = useCallback(() => {
    try {
      hlsRef.current?.destroy();
    } catch {
      /* */
    }
    hlsRef.current = null;
    hlsQualityPickRef.current = { heights: [], levelIdxs: [] };
    setHlsMode(false);
    setHlsNativeQualityLock(false);
  }, []);

  const setupQualityFromLink = useCallback((linkObj: KodikLinkResponse, mp4Url: string) => {
    const mq = linkObj && typeof linkObj === "object" ? linkObj.kodik_max_quality : null;
    const list = availableQualities(mq ?? undefined);
    const inferred = inferQualityFromUrl(mp4Url);
    const current = inferred && list.includes(inferred) ? inferred : list[list.length - 1];
    setQualityOptions(list);
    setSelectedQuality(current);
  }, []);

  const playStream = useCallback(
    async (opts: PlayStreamOptions) => {
      const {
        animeId: id,
        translationId: tid,
        episode: ep,
        resumeAfterLoadSec,
        savedResumeSec,
        preloaded,
        bootstrapMs = 0,
        staleLinkRetry = false,
        forceMp4 = false,
      } = opts;
      if (!staleLinkRetry) {
        staleLinkRetryCountRef.current = 0;
      }
      const reqId = ++playReqIdRef.current;
      const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      const trace: StartupTrace = {
        bootstrapMs: bootstrapMs,
        linkMs: 0,
        manifestMs: 0,
        firstFrameMs: 0,
        firstPlayMs: 0,
        mode: "MP4",
        net: getStartupNetworkHints().label,
        client: startupClientLabel(inTelegram),
      };
      const netHints = getStartupNetworkHints();
      trace.net = netHints.label;
      const mp4FirstMode = shouldMp4FirstStart(inTelegram, netHints);
      const directMp4 = shouldDirectMp4Url(inTelegram);
      const persistedResume = readResumeSec(id, tid, ep);
      const liveResume =
        resumeAfterLoadSec != null && Number.isFinite(resumeAfterLoadSec) && resumeAfterLoadSec > 0.25
          ? resumeAfterLoadSec
          : null;
      const savedResume =
        savedResumeSec != null && Number.isFinite(savedResumeSec) && savedResumeSec > 0.25
          ? savedResumeSec
          : null;
      const resumeSec = liveResume ?? persistedResume ?? savedResume;
      const hasResume = resumeSec != null && resumeSec > 0.25;
      if (hasResume) {
        setResumeHintSec(Math.floor(resumeSec));
        setResumeHintEpisode(ep);
      } else if (!staleLinkRetry) {
        setResumeHintSec(null);
        setResumeHintEpisode(null);
      }
      if (!earlyStartMatches(id, tid, ep)) {
        earlyVideoStartedRef.current = false;
        earlyStartTargetRef.current = null;
      }

      const publishStartupTrace = (partial?: Partial<StartupTrace>) => {
        if (partial) Object.assign(trace, partial);
        const line = formatStartupTrace(trace);
        setStartupBreakdown(line);
        if (showDebug || showStartupTrace) logStartupTrace(trace);
      };
      publishStartupTraceRef.current = publishStartupTrace;

      setVideoErr(null);
      setNeedsPlayTap(false);
      setBusy(true);
      const skipFullscreenLoader = Boolean(
        preloaded?.player_url && earlyStartMatches(id, tid, ep),
      );
      if (!skipFullscreenLoader) setAwaitingFirstFrame(true);
      try {
        /* Авто-fallback на кэш: если caller не передал preloaded, но link уже свежий в LRU —
           стартуем мгновенно, без сетевого RTT. */
        const cachedLink = preloaded ?? (id && tid ? cacheGet(linkCache, `${id}:${tid}:${ep}`) : null);
        const out =
          cachedLink ??
          ((await (async () => {
            setStatus("запрашиваю /kodik/link…");
            const clientQ = getSutekiApiClient();
            const linkPath = `/api/v1/anime/${encodeURIComponent(id)}/kodik/link?episode=${encodeURIComponent(ep)}&translation_id=${encodeURIComponent(tid)}${clientQ ? `&client=${encodeURIComponent(clientQ)}` : ""}`;
            return apiJson(linkPath);
          })()) as KodikLinkResponse);
        if (out?.player_url) {
          cacheSet(linkCache, `${id}:${tid}:${ep}`, out, CACHE_TTL_LINK_MS);
          preconnectMediaOrigin(out.player_url);
          preloadMp4Url(out.player_url);
        }
        trace.linkMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;

        const markersForEp = pickSkipMarkersFromKodikLink(out);
        setSkipMarkers(markersForEp);
        openingAutoSkippedRef.current = false;
        const embedForSkip = typeof out.kodik_embed_url === "string" ? out.kodik_embed_url.trim() : "";
        if (embedForSkip && !hasAnySkipMarker(markersForEp)) {
          void fetchKodikSkipMarkersAsync(embedForSkip, apiJson).then((m) => {
            if (!m || reqId !== playReqIdRef.current) return;
            setSkipMarkers(m);
            const vNow = videoRef.current;
            if (vNow && !openingAutoSkippedRef.current && shouldAutoSkipOpening(m, resumeSec, vNow.currentTime)) {
              openingAutoSkippedRef.current = true;
              seekVideoToSec(vNow, m.openingEndSec!);
            }
          });
        }

        const mp4 = out && typeof out.player_url === "string" ? out.player_url.trim() : "";
        if (!mp4) {
          setStatus("Видео недоступно для этой серии.", { error: true });
          setAwaitingFirstFrame(false);
          return;
        }

        destroyHls();

        const v = videoRef.current;
        if (!v) {
          setAwaitingFirstFrame(false);
          return;
        }

        const hlsRaw = typeof out.hls_manifest_url === "string" ? out.hls_manifest_url.trim() : "";
        const skipHlsOnStart = mp4FirstMode;
        const tryHls = shouldTryHlsStart(hlsRaw, skipHlsOnStart) && !forceMp4;
        const startupMp4Target = pickKodikMp4Quality(out, netHints);
        const startupMp4 = mp4FirstMode ? replaceQualityInUrl(mp4, startupMp4Target) : mp4;
        let startedHls = false;
        let fallbackReason = "none";
        const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
        let clearFrameWatchdog: () => void = () => {};
        if (typeof window !== "undefined") {
          const frameWatchdog = window.setTimeout(() => {
            if (reqId !== playReqIdRef.current) return;
            setAwaitingFirstFrame(false);
          }, firstFrameWatchdogMs(inTelegram));
          clearFrameWatchdog = () => clearTimeout(frameWatchdog);
        }
        const onFirstFrame = () => {
          clearFrameWatchdog();
          if (trace.firstFrameMs <= 0) trace.firstFrameMs = nowMs() - startedAt;
          setAwaitingFirstFrame(false);
          publishStartupTrace({});
        };
        const onCanPlay = () => {
          /* На iOS буфер до `playing` может занимать 10+ с — убираем полноэкранный лоадер раньше. */
          if (reqId === playReqIdRef.current) setAwaitingFirstFrame(false);
        };
        const tryAutoSkipOpening = () => {
          const vNow = videoRef.current;
          if (!vNow || openingAutoSkippedRef.current) return;
          if (!shouldAutoSkipOpening(markersForEp, resumeSec, vNow.currentTime)) return;
          openingAutoSkippedRef.current = true;
          seekVideoToSec(vNow, markersForEp.openingEndSec!);
        };
        const onFirstPlay = () => {
          staleLinkRetryCountRef.current = 0;
          if (trace.firstPlayMs <= 0) trace.firstPlayMs = nowMs() - startedAt;
          publishStartupTrace({});
          tryAutoSkipOpening();
        };
        const playbackHooks = {
          onAutoplayBlocked: () => {
            trace.autoplayBlocked = true;
            setAwaitingFirstFrame(false);
            setNeedsPlayTap(true);
            publishStartupTrace({});
          },
          onFirstFrame: () => {
            onFirstFrame();
            tryAutoSkipOpening();
          },
          onFirstPlay,
        };
        v.addEventListener("canplay", onCanPlay, { once: true });
        const playOpts = {
          tryMutedAutoplay: shouldAutoplayMuted(),
          unmuteAfterAutoplay: true,
        };

        const onVideoError = () => {
          if (reqId !== playReqIdRef.current) return;
          const err = v.error;
          const code = err && typeof err.code === "number" ? err.code : 0;
          const src = String(v.currentSrc || v.src || "").slice(0, 220);
          if (showDebug) console.warn("video_error", { code, src });
          const canStaleRetry =
            STALE_LINK_MEDIA_ERROR_CODES.has(code) && staleLinkRetryCountRef.current < MAX_STALE_LINK_MEDIA_RETRIES;
          if (canStaleRetry) {
            staleLinkRetryCountRef.current += 1;
            const resumeT =
              Number.isFinite(v.currentTime) && v.currentTime > 0.25 ? v.currentTime : (resumeSec ?? null);
            linkCache.delete(`${id}:${tid}:${ep}`);
            setVideoErr(null);
            setStatus("Ссылка на видео устарела, запрашиваю новую…");
            destroyHls();
            v.pause();
            v.removeAttribute("src");
            v.load();
            v.onerror = null;
            void playStreamRef.current?.({
              animeId: id,
              translationId: tid,
              episode: ep,
              resumeAfterLoadSec: resumeT,
              preloaded: null,
              staleLinkRetry: true,
              bootstrapMs: 0,
            });
            return;
          }
          setAwaitingFirstFrame(false);
          const userMsg = formatVideoError(code);
          setVideoErr(userMsg);
          setStatus(userMsg, { error: true });
        };
        const startMp4Fallback = (mode: StartupMode = mp4FirstMode ? "mini-fast" : "MP4") => {
          setHlsMode(false);
          setupQualityFromLink(out, startupMp4);
          setStatus(mode === "mini-fast" ? "быстрый старт MP4…" : "переключаюсь на MP4…");
          setRawMp4(startupMp4);
          warmMp4HeadWindow(startupMp4, { direct: directMp4, lite: inTelegram });
          v.pause();
          v.src = proxifyMediaUrl(startupMp4, { direct: directMp4 });
          v.load();
          publishStartupTrace({
            mode,
            fallback:
              fallbackReason !== "none"
                ? fallbackReason
                : tryHls
                  ? undefined
                  : hlsRaw
                    ? "hls_skipped"
                    : "no_hls_manifest",
          });
          playVideoAsap(v, resumeSec, playbackHooks, playOpts);
          v.onerror = onVideoError;
        };

        if (tryHls) {
          setStatus("загружаю HLS…");
          setRawMp4(mp4);
          v.pause();
          v.removeAttribute("src");
          v.load();
          v.onerror = onVideoError;

          const { default: HlsMod } = await ensureHlsPreloaded();
          const manifestSrc = resolveHlsManifestUrl(hlsRaw);

          if (HlsMod.isSupported()) {
            setHlsMode(true);
            setHlsNativeQualityLock(false);
            const hls = new HlsMod({
              ...HLS_VOD_OPTIONS,
              ...HLS_INSTANT_START_OPTIONS,
              abrEwmaDefaultEstimate: netHints.abrEstimate,
              ...(hasResume ? { startPosition: resumeSec! } : {}),
            });
            hlsRef.current = hls;
            hls.loadSource(manifestSrc);
            hls.attachMedia(v);
            let hlsBufferExpanded = false;
            const onHlsPlayingExpand = () => {
              if (hlsBufferExpanded || hlsRef.current !== hls) return;
              hlsBufferExpanded = true;
              expandHlsBufferAfterPlay(hls);
              tryAutoSkipOpening();
            };
            v.addEventListener("playing", onHlsPlayingExpand, { once: true });
            const hlsForPlay = hls;
            let hlsPlayStarted = false;
            let hlsRecoverCount = 0;

            const failHlsToMp4 = (reason: string) => {
              if (hlsStartWatchdog != null) {
                clearTimeout(hlsStartWatchdog);
                hlsStartWatchdog = null;
              }
              if (hlsRef.current === hlsForPlay) {
                try {
                  hlsForPlay.destroy();
                } catch {
                  /* */
                }
                hlsRef.current = null;
              }
              fallbackReason = reason;
              setVideoErr(null);
              setStatus(
                hlsPlayStarted ? "HLS: переключаюсь на MP4…" : "Ошибка HLS до старта, переключаюсь на MP4…",
              );
              startMp4Fallback(hlsPlayStarted ? "MP4" : mp4FirstMode ? "mini-fast" : "MP4");
            };

            const restartWithFreshLink = (mp4Only: boolean) => {
              if (hlsStartWatchdog != null) {
                clearTimeout(hlsStartWatchdog);
                hlsStartWatchdog = null;
              }
              if (hlsRef.current === hlsForPlay) {
                try {
                  hlsForPlay.destroy();
                } catch {
                  /* */
                }
                hlsRef.current = null;
              }
              if (staleLinkRetryCountRef.current >= MAX_STALE_LINK_MEDIA_RETRIES) {
                failHlsToMp4(mp4Only ? "hls_frag_parse" : "hls_fatal_after_start");
                return;
              }
              staleLinkRetryCountRef.current += 1;
              linkCache.delete(`${id}:${tid}:${ep}`);
              const resumeT =
                Number.isFinite(v.currentTime) && v.currentTime > 0.25 ? v.currentTime : (resumeSec ?? null);
              setVideoErr(null);
              setStatus(mp4Only ? "HLS: битый фрагмент, MP4…" : "HLS: обновляю источник…");
              void playStreamRef.current?.({
                animeId: id,
                translationId: tid,
                episode: ep,
                resumeAfterLoadSec: resumeT,
                preloaded: null,
                staleLinkRetry: true,
                bootstrapMs: 0,
                forceMp4: mp4Only,
              });
            };

            let hlsStartWatchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
              if (hlsPlayStarted || hlsRef.current !== hlsForPlay) return;
              try {
                hlsForPlay.destroy();
              } catch {
                /* */
              }
              hlsRef.current = null;
              fallbackReason = "hls_watchdog_timeout";
              setStatus("HLS долго стартует, переключаюсь на MP4…");
              startMp4Fallback();
            }, hasResume ? HLS_START_WATCHDOG_RESUME_MS : HLS_START_WATCHDOG_MS);
            const kickHlsPlay = () => {
              if (hlsPlayStarted || hlsRef.current !== hlsForPlay) return;
              staleLinkRetryCountRef.current = 0;
              hlsPlayStarted = true;
              if (hlsStartWatchdog != null) {
                clearTimeout(hlsStartWatchdog);
                hlsStartWatchdog = null;
              }
              publishStartupTrace({ mode: "HLS" });
              setStatus("старт HLS…");
              playVideoAsap(v, resumeSec, playbackHooks, playOpts);
            };
            hls.on(HlsMod.Events.MANIFEST_PARSED, () => {
              trace.manifestMs = nowMs() - startedAt;
              const pick = buildHlsQualityPick(hls.levels);
              hlsQualityPickRef.current = pick;
              setQualityOptions(pick.heights);
              const initialLevelIdx = pickInitialHlsLevelIdx(pick, netHints.maxStartHeight);
              if (initialLevelIdx != null) {
                hls.startLevel = initialLevelIdx;
                hls.currentLevel = initialLevelIdx;
              }
              if (pick.heights.length) {
                if (initialLevelIdx != null) {
                  const oi = pick.levelIdxs.indexOf(initialLevelIdx);
                  setSelectedQuality(oi >= 0 ? pick.heights[oi] : pick.heights[pick.heights.length - 1]!);
                } else {
                  setSelectedQuality(pick.heights[pick.heights.length - 1]!);
                }
              }
              setStatus("старт…");
              // ранний старт: пробуем играть сразу, как только манифест разобран
              kickHlsPlay();
            });
            hls.on(HlsMod.Events.FRAG_BUFFERED, kickHlsPlay);
            hls.on(HlsMod.Events.BUFFER_APPENDED, kickHlsPlay);
            hls.on(HlsMod.Events.LEVEL_SWITCHED, (_, data) => {
              const inst = hlsRef.current;
              if (!inst) return;
              const levelIdx =
                data && typeof data === "object" && "level" in data && typeof (data as { level?: unknown }).level === "number"
                  ? (data as { level: number }).level
                  : inst.currentLevel;
              if (levelIdx < 0 || !inst.levels[levelIdx]) return;
              const pick = hlsQualityPickRef.current;
              const oi = pick.levelIdxs.indexOf(levelIdx);
              if (oi >= 0) setSelectedQuality(pick.heights[oi]);
              else {
                const h = estimateHeightFromHlsLevel(inst.levels[levelIdx]);
                if (pick.heights.includes(h)) setSelectedQuality(h);
              }
            });
            hls.on(HlsMod.Events.ERROR, (_, data) => {
              const details = String(data.details || "");
              const isFragParse =
                details.includes("fragParsingError") || details.includes("FRAG_PARSING_ERROR");
              if (showDebug) console.warn("hls_error", data);

              if (!data.fatal) return;
              if (hlsRef.current !== hlsForPlay) return;

              if (data.type === HlsMod.ErrorTypes.NETWORK_ERROR && hlsRecoverCount < HLS_RECOVER_MAX) {
                hlsRecoverCount += 1;
                setStatus(`HLS: сеть, повтор (${hlsRecoverCount})…`);
                try {
                  hlsForPlay.startLoad();
                  return;
                } catch {
                  /* fall through */
                }
              }

              if (data.type === HlsMod.ErrorTypes.MEDIA_ERROR && hlsRecoverCount < HLS_RECOVER_MAX) {
                hlsRecoverCount += 1;
                setStatus(`HLS: media recover (${hlsRecoverCount})…`);
                try {
                  hlsForPlay.recoverMediaError();
                  return;
                } catch {
                  /* fall through */
                }
              }

              // fragParsingError: CDN отдал HTML/битый сегмент или протух URL в m3u8
              if (isFragParse) {
                restartWithFreshLink(true);
                return;
              }

              if (!hlsPlayStarted) {
                failHlsToMp4("hls_fatal_before_start");
                return;
              }

              restartWithFreshLink(false);
            });
            startedHls = true;
          } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
            setHlsMode(true);
            setHlsNativeQualityLock(true);
            hlsQualityPickRef.current = { heights: [], levelIdxs: [] };
            setQualityOptions([720]);
            setSelectedQuality(720);
            v.src = manifestSrc;
            v.load();
            v.onerror = onVideoError;
            const onCanPlayHls = () => {
              staleLinkRetryCountRef.current = 0;
              publishStartupTrace({ mode: "HLS(native)" });
              setStatus("старт HLS (native)…");
              playVideoAsap(v, resumeSec, playbackHooks, playOpts);
            };
            v.addEventListener("loadedmetadata", onCanPlayHls, { once: true });
            startedHls = true;
          }
        }

        if (!startedHls) {
          if (skipHlsOnStart && tryHls) {
            fallbackReason = "mobile_mp4_first";
          } else if (hlsRaw && !tryHls) {
            fallbackReason = "hls_skipped";
          }
          startMp4Fallback(skipHlsOnStart ? "mini-fast" : "MP4");
        }
      } catch (e) {
        console.error(e);
        if (reqId === playReqIdRef.current) {
          setAwaitingFirstFrame(false);
          setStatus(formatApiError(e), { error: true });
        }
      } finally {
        if (reqId === playReqIdRef.current) {
          setBusy(false);
        }
      }
    },
    [apiJson, destroyHls, ensureHlsPreloaded, inTelegram, setStatus, setupQualityFromLink, showDebug, showStartupTrace],
  );

  useEffect(() => {
    playStreamRef.current = playStream;
  }, [playStream]);

  const loadAnimeAndPlay = useCallback(
    async (
      id: number,
      preferredTid: string | null,
      ep: number,
      savedResumeSec: number | null = null,
    ): Promise<string | null> => {
      const reqId = ++loadAnimeReqIdRef.current;
      const bootstrapStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      setLoadingBootstrap(true);
      setBusy(true);
      setGeoBlocked(false);
      setTrSearch("");
      setAnimeId(id);
      try {
        setStatus("загрузка…");
        const pref = preferredTid?.trim() || null;

        const bootstrapCacheKey = `${id}:${pref || "auto"}:${ep}`;
        let data = cacheGet(bootstrapCache, bootstrapCacheKey);
        if (!data) {
          const warm = warmBootstrap(id, pref, ep);
          data = warm
            ? await warm
            : ((await apiJson(
                playerBootstrapUrl(id, {
                  translationId: pref,
                  episode: ep,
                  includeLink: true,
                  client: getSutekiApiClient(),
                }),
              )) as PlayerBootstrapResponse);
          cacheSet(bootstrapCache, bootstrapCacheKey, data, CACHE_TTL_BOOTSTRAP_MS);
        }

        if (reqId !== loadAnimeReqIdRef.current) return null;

        const tid = applyBootstrapData(data, preferredTid, ep);
        if (!tid) return null;

        // Link от bootstrap подходит, только если совпал tid и серия.
        let link: KodikLinkResponse | null = null;
        const srvLink = data.link as (KodikLinkResponse & { unavailable?: boolean }) | null | undefined;
        if (
          srvLink &&
          !srvLink.unavailable &&
          typeof srvLink.player_url === "string" &&
          srvLink.player_url.trim() &&
          (data.translation_id ? String(data.translation_id) === tid : tid === pref)
        ) {
          link = srvLink as KodikLinkResponse;
          cacheSet(linkCache, `${id}:${tid}:${ep}`, link, CACHE_TTL_LINK_MS);
          preconnectMediaOrigin(link.player_url);
          preloadMp4Url(link.player_url);
        }
        if (!link) {
          link = await fetchKodikLinkQuiet(id, tid, ep);
        }
        if (reqId !== loadAnimeReqIdRef.current) return null;

        const bootstrapWatch = data.watch as WatchPayload;
        const needsEpisodesFetch =
          !(data.episodes && typeof data.episodes === "object") &&
          !translationHasSeriesRangeForTranslationId(bootstrapWatch, tid);
        if (needsEpisodesFetch) void loadEpisodes(id, tid).catch(() => null);
        if (link?.player_url) {
          const bootstrapMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - bootstrapStartedAt;
          void playStream({
            animeId: id,
            translationId: tid,
            episode: ep,
            preloaded: link,
            bootstrapMs,
            savedResumeSec,
          });
        } else {
          setAwaitingFirstFrame(false);
          const msg = "Видео недоступно для этой серии.";
          setVideoErr(msg);
          setStatus(msg, { error: true });
        }
        return tid;
      } catch (e) {
        console.error(e);
        const userMsg = formatApiError(e);
        setAwaitingFirstFrame(false);
        setVideoErr(userMsg);
        setStatus(userMsg, { error: true });
        return null;
      } finally {
        setLoadingBootstrap(false);
        setBusy(false);
      }
    },
    [
      apiJson,
      applyBootstrapData,
      fetchKodikLinkQuiet,
      loadEpisodes,
      playStream,
      setStatus,
    ],
  );

  const playSelected = useCallback(
    async (episodeOverride?: number) => {
      const id = Number(animeId || 0);
      const tid = String(translationId || "").trim();
      const ep =
        episodeOverride !== undefined && Number.isFinite(episodeOverride) && episodeOverride > 0
          ? Math.floor(episodeOverride)
          : Number(episode || 1) || 1;
      if (!id || !tid) {
        setStatus("Нужны выбранный тайтл и озвучка.", { error: true });
        return;
      }
      setAnimeId(id);
      setTranslationId(tid);
      setEpisode(ep);
      replaceUrlAnime(id, ep, tid);
      const prefetched = cacheGet(linkCache, `${id}:${tid}:${ep}`) ?? null;
      await playStream({ animeId: id, translationId: tid, episode: ep, preloaded: prefetched });
    },
    [animeId, episode, playStream, setStatus, translationId],
  );

  useEffect(() => {
    loadAnimeAndPlayRef.current = loadAnimeAndPlay;
  }, [loadAnimeAndPlay]);

  useEffect(() => {
    if (!parsedAnimeId || userPickedAnimeRef.current) return;
    const ep = launchWatch?.episode ?? parsedEp;
    const tid = launchWatch?.translationId ?? (qpTid ? String(qpTid) : null);
    void loadAnimeAndPlayRef.current
      ?.(parsedAnimeId, tid, ep, launchWatch?.savedResumeSec ?? null)
      .then((resolvedTid) => {
        if (resolvedTid && launchWatch?.usedSavedEpisode) {
          replaceUrlAnime(parsedAnimeId, ep, resolvedTid);
        }
      })
      .catch((e) => {
        console.error(e);
        setStatus(`Ошибка по ссылке: ${String(e instanceof Error ? e.message : e)}`, { error: true });
      });
  }, [parsedAnimeId, qpTid, parsedEp, launchWatch, setStatus]);

  const selectTranslation = useCallback(
    (tid: string) => {
      if (!animeId) return;
      tgHaptic("light");
      void (async () => {
        try {
          const v = videoRef.current;
          const resumeAfterLoadSec =
            v && Number.isFinite(v.currentTime) && v.currentTime > 0.25 ? v.currentTime : null;
          const keepEp = Math.max(1, Math.floor(Number(episode) || 1));
          setTranslationId(tid);
          setEpisode(keepEp);
          const useLocal = watch ? translationHasSeriesRangeForTranslationId(watch, tid) : false;
          const pEpisodes = useLocal
            ? Promise.resolve().then(() => {
                setEpisodes(buildKodikEpisodesPayloadFromWatch(watch!, tid, 12));
              })
            : loadEpisodes(animeId, tid);
          const pPlay = playStream({
            animeId,
            translationId: tid,
            episode: keepEp,
            resumeAfterLoadSec,
          });
          void pEpisodes;
          await pPlay;
        } catch (err) {
          console.error(err);
          setStatus(formatApiError(err), {
            error: true,
          });
        }
      })();
    },
    [animeId, episode, loadEpisodes, playStream, setStatus, watch],
  );

  const switchQuality = useCallback(async function switchQuality(nextQ: number) {
      if (hlsMode) {
        const hls = hlsRef.current;
        if (!hls) {
          setStatus("Нативный HLS (Safari): переключение качества недоступно.", { error: false });
          return;
        }
        const pick = hlsQualityPickRef.current;
        const oi = pick.heights.indexOf(nextQ);
        if (oi < 0) return;
        const levelIdx = pick.levelIdxs[oi];
        if (levelIdx === undefined) return;
        hls.currentLevel = levelIdx;
        setSelectedQuality(nextQ);
        setStatus(`качество: ${nextQ}p`);
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      const raw = String(rawMp4 || "").trim();
      if (!raw) return;

      const nextRaw = replaceQualityInUrl(raw, nextQ);
      const nextUrl = proxifyMediaUrl(nextRaw, { direct: shouldDirectMp4Url() });
      const curProxied = String(v.currentSrc || v.src || "").trim();
      if (!nextUrl || nextUrl === curProxied) return;

      const t = v.currentTime || 0;
      const wasPaused = v.paused;
      setSelectedQuality(nextQ);
      setRawMp4(nextRaw);
      setStatus(`переключаю качество на ${nextQ}p…`);

      v.pause();
      v.src = nextUrl;
      v.load();

      const onReady = async () => {
        v.removeEventListener("canplay", onReady);
        try {
          if (Number.isFinite(t) && t > 0) v.currentTime = t;
        } catch {
          /* */
        }
        if (!wasPaused) {
          try {
            await v.play();
          } catch {
            /* */
          }
        }
        setStatus(`качество: ${nextQ}p`);
      };
      v.addEventListener("canplay", onReady);
    },
    [hlsMode, rawMp4, setStatus],
  );

  switchQualityRef.current = (q) => {
    void switchQuality(q);
  };

  const qualitySelectDisabled = qualityOptions.length <= 1 || hlsNativeQualityLock;

  const activeQuality =
    selectedQuality !== "" ? selectedQuality : (qualityOptions[0] ?? "");

  useEffect(() => {
    const plyr = plyrRef.current;
    if (!plyr) return;
    const selected = typeof activeQuality === "number" ? activeQuality : undefined;
    if (qualitySelectDisabled) {
      syncPlyrQualityMenu(plyr, qualityOptions.length ? qualityOptions : []);
      return;
    }
    syncPlyrQualityMenu(plyr, qualityOptions, selected);
  }, [activeQuality, qualityOptions, qualitySelectDisabled]);

  const activeTranslationLabelForDebug = useMemo(() => {
    const trs = watch && Array.isArray(watch.translations) ? watch.translations : [];
    const tr = trs.find((x) => translationRowHasId(x) && translationRowIdString(x) === String(translationId));
    if (tr) return formatTranslationLabel(tr);
    if (translationId) return `id ${translationId}`;
    return "—";
  }, [watch, translationId]);

  const playbackDebugText = useMemo(() => {
    const { current, duration, paused } = playbackDebug;
    const cur = formatClockSec(current);
    const dur = Number.isFinite(duration) && duration > 0 ? formatClockSec(duration) : "…";
    return `${cur} / ${dur}${paused ? " · пауза" : ""}`;
  }, [playbackDebug]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const read = () => {
      setPlaybackDebug({
        current: v.currentTime,
        duration: v.duration,
        paused: v.paused,
      });
    };

    let throttle: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (throttle != null) return;
      throttle = setTimeout(() => {
        throttle = null;
        read();
      }, 140);
    };

    read();
    v.addEventListener("timeupdate", schedule);
    v.addEventListener("seeked", read);
    v.addEventListener("play", read);
    v.addEventListener("pause", read);
    v.addEventListener("loadedmetadata", read);
    v.addEventListener("durationchange", read);
    v.addEventListener("emptied", read);

    return () => {
      if (throttle != null) clearTimeout(throttle);
      v.removeEventListener("timeupdate", schedule);
      v.removeEventListener("seeked", read);
      v.removeEventListener("play", read);
      v.removeEventListener("pause", read);
      v.removeEventListener("loadedmetadata", read);
      v.removeEventListener("durationchange", read);
      v.removeEventListener("emptied", read);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const raw = watch && typeof watch.player_url === "string" ? watch.player_url.trim() : "";
    if (!raw) return;
    let origin: string;
    try {
      origin = new URL(raw).origin;
    } catch {
      return;
    }
    const id = "suteki-kodik-preconnect";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  }, [watch]);

  // Сохранение серии и позиции (секунды) в localStorage
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const id = animeId;
    const tid = translationId;
    const ep = episode;
    if (!id || !tid || !ep) return;

    let lastSaved = 0;
    const persist = () => {
      const t = v.currentTime;
      if (!Number.isFinite(t)) return;
      const now = Date.now();
      if (now - lastSaved < 4000) return;
      lastSaved = now;
      flushWatchProgress(id, tid, ep, t, v.duration, animeTitle || undefined);
    };
    const onPause = () =>
      flushWatchProgress(id, tid, ep, v.currentTime, v.duration, animeTitle || undefined);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushWatchProgress(id, tid, ep, v.currentTime, v.duration, animeTitle || undefined);
      }
    };
    const onEnded = () =>
      flushWatchProgress(id, tid, ep, v.duration, v.duration, animeTitle || undefined);
    v.addEventListener("timeupdate", persist);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPause);
    return () => {
      flushWatchProgress(id, tid, ep, v.currentTime, v.duration, animeTitle || undefined);
      v.removeEventListener("timeupdate", persist);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPause);
    };
  }, [animeId, translationId, episode, animeTitle]);

  // Прогрев следующей серии: (1) early — через 8с после старта; (2) при 60% длительности.
  const nextEpisodePrefetchedRef = useRef<string | null>(null);
  useEffect(() => {
    nextEpisodePrefetchedRef.current = null;
  }, [animeId, translationId, episode]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const id = animeId;
    const tid = translationId;
    const ep = episode;
    if (!id || !tid || !ep) return;
    const tryPrefetchNext = () => {
      const key = `${id}:${tid}:${ep + 1}`;
      if (nextEpisodePrefetchedRef.current === key) return;
      nextEpisodePrefetchedRef.current = key;
      void fetchKodikLinkQuiet(id, tid, ep + 1);
    };
    /* (1) Early-warm: в TG не делаем — лишняя нагрузка на слабых телефонах. */
    const earlyTimer = inTelegram ? null : window.setTimeout(tryPrefetchNext, 8000);
    /* (2) При 60% — пред-прогрев перед переключением по auto-next. */
    const onTime = () => {
      const d = v.duration;
      const t = v.currentTime;
      if (!Number.isFinite(d) || d <= 0) return;
      if (t < d * 0.6) return;
      tryPrefetchNext();
    };
    v.addEventListener("timeupdate", onTime);
    return () => {
      if (earlyTimer != null) clearTimeout(earlyTimer);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [animeId, translationId, episode, fetchKodikLinkQuiet, inTelegram]);

  const onVideoTimelineRefreshed = useCallback(() => {
    const v = videoRef.current;
    setPlayableEndKnown(Boolean(v && getPlayableEndSec(v) != null));
  }, []);

  const skipUi = useMemo(() => {
    const m = skipMarkers;
    if (!m) {
      return {
        canOpening: false,
        canEnding: false,
        showNoMarkersHint: false,
        endingNeedsMeta: false,
      };
    }
    const canOpening = m.openingEndSec != null;
    const canEnding = m.endingSkipToSec != null || (m.endingStartSec != null && playableEndKnown);
    const showNoMarkersHint = !hasAnySkipMarker(m);
    const endingNeedsMeta = m.endingSkipToSec == null && m.endingStartSec != null && !playableEndKnown;
    return { canOpening, canEnding, showNoMarkersHint, endingNeedsMeta };
  }, [skipMarkers, playableEndKnown]);

  const skipOpening = useCallback(() => {
    const v = videoRef.current;
    if (!v || skipMarkers?.openingEndSec == null) return;
    seekVideoToSec(v, skipMarkers.openingEndSec);
  }, [skipMarkers]);

  const skipEnding = useCallback(() => {
    const v = videoRef.current;
    if (!v || !skipMarkers) return;
    if (skipMarkers.endingSkipToSec != null) {
      seekVideoToSec(v, skipMarkers.endingSkipToSec);
      return;
    }
    if (skipMarkers.endingStartSec != null) {
      const end = getPlayableEndSec(v);
      if (end == null) return;
      seekVideoToSec(v, end - KODIK_SKIP_SEEK.edgeEpsilonSec);
    }
  }, [skipMarkers]);

  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = normalizeSearchQuery(rawQuery);
      if (!q) {
        setSearchResults([]);
        setSearchErr(null);
        setSearchDone(false);
        return;
      }

      const reqId = ++searchReqIdRef.current;
      setLoadingSearch(true);
      setSearchErr(null);
      try {
        const mapped = await searchAnime(q, 12);
        if (reqId !== searchReqIdRef.current) return;
        setSearchResults(mapped);
        setSearchDone(true);
      } catch (e) {
        if (reqId !== searchReqIdRef.current) return;
        setSearchErr(String(e instanceof Error ? e.message : e));
        setSearchResults([]);
        setSearchDone(true);
      } finally {
        if (reqId === searchReqIdRef.current) setLoadingSearch(false);
      }
    },
    [apiJson],
  );

  const searchNow = useCallback(() => {
    dismissSearchKeyboard();
    void runSearch(query || defaultQ);
  }, [defaultQ, dismissSearchKeyboard, query, runSearch]);

  const onQueryChange = useCallback((nextRaw: string) => {
    const next = nextRaw;
    setQuery(next);
    if (!normalizeSearchQuery(next)) {
      lastDebouncedQueryRef.current = "";
      setSearchResults([]);
      setSearchErr(null);
      setSearchDone(false);
    }
  }, []);

  useEffect(() => {
    const q = normalizeSearchQuery(query);
    if (!q) {
      return;
    }
    if (q === lastDebouncedQueryRef.current) return;
    const t = setTimeout(() => {
      lastDebouncedQueryRef.current = q;
      void runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const openAnimeFromSearchResult = useCallback(
    async (row: AnimeSearchRow) => {
      const newId = Number(row.anime_id);
      if (!Number.isFinite(newId) || newId <= 0) return;
      userPickedAnimeRef.current = true;
      setBusy(true);
      setVideoErr(null);
      setSearchResults([]);
      setSearchDone(false);
      try {
        setTrSearch("");
        setAnimeTitle(row.title || "");
        setWatch(null);
        setEpisodes(null);
        setChronology([]);
        const launch = resolveLaunchWatch(newId, { explicitEpisode: false, urlTranslationId: null });
        setEpisode(launch.episode);
        setTranslationId(launch.translationId);
        void warmBootstrap(newId, launch.translationId, launch.episode);
        if (animeId != null && Number(animeId) === newId && translationId) {
          await playSelected(launch.episode);
          replaceUrlAnime(newId, launch.episode, translationId);
          return;
        }
        const tid = await loadAnimeAndPlay(newId, launch.translationId, launch.episode, launch.savedResumeSec);
        if (!tid) {
          setStatus("Не удалось открыть тайтл.", { error: true });
          return;
        }
        replaceUrlAnime(newId, launch.episode, tid);
      } catch (e) {
        console.error(e);
        setVideoErr(formatApiError(e));
      } finally {
        setBusy(false);
      }
    },
    [animeId, loadAnimeAndPlay, playSelected, setStatus, translationId],
  );

  useEffect(() => {
    const id = animeId != null ? Number(animeId) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    let cancelled = false;
    let delayedRun: ReturnType<typeof setTimeout> | null = null;
    const runChronologyFetch = async () => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChronologyLoading(true);
      setChronologyErr(null);
      try {
        const payload = (await apiJson(`/api/v1/anime/${encodeURIComponent(id)}/chronology`)) as {
          results?: unknown;
        };
        const results = payload && Array.isArray(payload.results) ? (payload.results as ChronologyItem[]) : [];
        if (cancelled) return;
        setChronology(
          results
            .filter((r) => r && typeof r === "object" && Number((r as ChronologyItem).anime_id) > 0)
            .map((r) => ({
              anime_id: Number((r as ChronologyItem).anime_id),
              title: String((r as ChronologyItem).title || ""),
              original_title: (r as ChronologyItem).original_title ?? null,
              poster: (r as ChronologyItem).poster ?? null,
              kind: (r as ChronologyItem).kind ?? null,
              year: (r as ChronologyItem).year ?? null,
              date: (r as ChronologyItem).date ?? null,
            })),
        );
      } catch (e) {
        if (cancelled) return;
        setChronology([]);
        setChronologyErr(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setChronologyLoading(false);
      }
    };
    if (inTelegram) delayedRun = setTimeout(() => void runChronologyFetch(), 4000);
    else void runChronologyFetch();
    return () => {
      cancelled = true;
      if (delayedRun != null) clearTimeout(delayedRun);
    };
  }, [animeId, apiJson, inTelegram]);

  const navOpts = useMemo(() => episodeOptions.filter((x) => !x.disabled), [episodeOptions]);
  const navEpisodeNumbers = useMemo(
    () => navOpts.map((o) => Math.floor(Number(o.value) || 0)).filter((n) => Number.isFinite(n) && n > 0),
    [navOpts],
  );
  const currentEpisodeIndex = useMemo(
    () => navEpisodeNumbers.findIndex((n) => n === Math.floor(Number(episode) || 1)),
    [episode, navEpisodeNumbers],
  );
  const canPrevEpisode = currentEpisodeIndex > 0;
  const canNextEpisode = currentEpisodeIndex >= 0 && currentEpisodeIndex < navEpisodeNumbers.length - 1;

  const scrollEpisodeButtonIntoView = useCallback((n: number) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`ep-strip-btn-${n}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, []);

  const onPickEpisode = useCallback((n: number) => {
    const ep = Number(n) || 1;
    if (!Number.isFinite(ep) || ep < 1) return;
    if (loadingBootstrap) return;
    if (Math.floor(Number(episode) || 1) === ep) return;
    tgHaptic("light");
    setEpisodeJumpInput(String(ep));
    scrollEpisodeButtonIntoView(ep);
    void playSelected(ep);
  }, [episode, loadingBootstrap, playSelected, scrollEpisodeButtonIntoView]);

  const goPrevEpisode = useCallback(() => {
    if (!canPrevEpisode) return;
    const target = navEpisodeNumbers[currentEpisodeIndex - 1];
    if (!target) return;
    onPickEpisode(target);
  }, [canPrevEpisode, currentEpisodeIndex, navEpisodeNumbers, onPickEpisode]);

  const goNextEpisode = useCallback(() => {
    if (!canNextEpisode) return;
    const target = navEpisodeNumbers[currentEpisodeIndex + 1];
    if (!target) return;
    onPickEpisode(target);
  }, [canNextEpisode, currentEpisodeIndex, navEpisodeNumbers, onPickEpisode]);

  const showEpisodeJumpHint = useCallback((text: string, error: boolean) => {
    if (episodeJumpHintTimerRef.current) clearTimeout(episodeJumpHintTimerRef.current);
    setEpisodeJumpHint({ text, error });
    episodeJumpHintTimerRef.current = setTimeout(() => {
      setEpisodeJumpHint(null);
      episodeJumpHintTimerRef.current = null;
    }, 3200);
  }, []);

  const goToEpisodeFromInput = useCallback(() => {
    const raw = episodeJumpInput.trim();
    if (loadingBootstrap) {
      showEpisodeJumpHint("список серий ещё загружается", true);
      return;
    }
    if (!animeId || !translationId) {
      showEpisodeJumpHint("сначала выберите тайтл и озвучку", true);
      return;
    }
    if (!raw) {
      showEpisodeJumpHint("введите номер серии", true);
      return;
    }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) {
      showEpisodeJumpHint("нужен номер от 1", true);
      return;
    }
    if (episodeOptions.length === 0) {
      showEpisodeJumpHint("серии не загружены", true);
      return;
    }
    const opt = episodeOptions.find((o) => Number(o.value) === n);
    if (!opt) {
      const nums = episodeOptions.map((o) => Number(o.value)).filter((x) => Number.isFinite(x));
      const lo = nums.length ? Math.min(...nums) : 1;
      const hi = nums.length ? Math.max(...nums) : 1;
      showEpisodeJumpHint(`нет серии ${n} (в списке ${lo}–${hi})`, true);
      return;
    }
    scrollEpisodeButtonIntoView(n);
    if (opt.disabled) {
      showEpisodeJumpHint(`серия ${n} недоступна`, true);
      return;
    }
    if (episodeJumpHintTimerRef.current) clearTimeout(episodeJumpHintTimerRef.current);
    setEpisodeJumpHint(null);
    onPickEpisode(n);
  }, [
    animeId,
    episodeJumpInput,
    episodeOptions,
    loadingBootstrap,
    onPickEpisode,
    scrollEpisodeButtonIntoView,
    showEpisodeJumpHint,
    translationId,
  ]);

  useEffect(() => {
    return () => {
      if (episodeJumpHintTimerRef.current) clearTimeout(episodeJumpHintTimerRef.current);
    };
  }, []);

  const episodesMeta = loadingBootstrap ? "…" : `${navOpts.length} серий`;

  useEffect(() => {
    if (loadingBootstrap || showEpisodesLoading || episodeOptions.length === 0) return;
    scrollEpisodeButtonIntoView(Math.floor(Number(episode) || 1));
  }, [episode, episodeOptions.length, loadingBootstrap, scrollEpisodeButtonIntoView, showEpisodesLoading]);

  /* Полноэкранный лоадер только пока нет ссылки; буфер видео — лёгкий индикатор (buffering). */
  const showLoadOverlay = (busy || loadingBootstrap) && !needsPlayTap;
  const showVideoBufferHint = awaitingFirstFrame && !loadingBootstrap && !busy && !needsPlayTap;

  const kodikNotConfigured =
    watch?.unavailable_reason === "not_configured" || watch?.unavailable_reason === "init";

  const translationsCount = useMemo(() => {
    const trs = watch && Array.isArray(watch.translations) ? watch.translations : [];
    return trs.filter((t) => translationRowHasId(t)).length;
  }, [watch]);

  const chronologyTv = useMemo(() => chronology.filter((c) => isTvChronologyKind(c.kind)), [chronology]);
  const chronologyOther = useMemo(() => chronology.filter((c) => !isTvChronologyKind(c.kind)), [chronology]);

  const renderChronologyStrip = (items: ChronologyItem[], title: string, key: string) => {
    if (!items.length) return null;
    return (
      <div className={`sh-card sh-chronology sh-chronology-${key}`} aria-label={title}>
        <div className="sh-chronology-head">
          <strong>{title}</strong>
          <div className="sh-chronology-meta">{items.length}</div>
        </div>
        <div className="sh-chronology-strip" role="list" aria-label={title}>
          {items.map((c) => {
            const cardTitle = c.title || `#${c.anime_id}`;
            const poster = c.poster;
            const active = animeId != null && Number(animeId) === Number(c.anime_id);
            const meta = [c.kind ? String(c.kind).toUpperCase() : null, c.year ? String(c.year) : null]
              .filter(Boolean)
              .join(" • ");
            return (
              <button
                key={`ch-${key}-${c.anime_id}`}
                type="button"
                role="listitem"
                className={`sh-chronology-card${active ? " active" : ""}`}
                onClick={() =>
                  void openAnimeFromSearchResult({
                    anime_id: c.anime_id,
                    title: cardTitle,
                    poster: poster ?? null,
                    original_title: c.original_title ?? null,
                  })
                }
                disabled={loadingBootstrap}
                title={cardTitle}
              >
                <span className="sh-chronology-poster" aria-hidden>
                  {poster ? (
                    <img src={poster} alt="" width={52} height={74} className="sh-chronology-img" />
                  ) : (
                    <span className="sh-chronology-poster-ph" />
                  )}
                </span>
                <span className="sh-chronology-main">
                  <span className="sh-chronology-title">{cardTitle}</span>
                  {meta ? <span className="sh-chronology-sub">{meta}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const showTranslationsLoading =
    !kodikNotConfigured &&
    !geoBlocked &&
    (loadingBootstrap || (!watch && Boolean(animeId)));
  const showTranslationsEmpty =
    !kodikNotConfigured &&
    !geoBlocked &&
    !loadingBootstrap &&
    watch != null &&
    translationsCount === 0;

  return (
    <main className="sh-page" aria-busy={busy || loadingBootstrap || loadingSearch}>
      <div className="sh-shell">
        <div className="sh-card sh-search" role="search">
          <div className="sh-search-top">
            <div className="sh-search-brand" aria-hidden>
              <span className="sh-brand-suteki">SUTEKI</span>
              <span className="sh-brand-hub">hub</span>
            </div>
            {!inTelegram ? (
              <button
                type="button"
                className="sh-home-link"
                onClick={() => pushLaunchShikiId(null)}
              >
                ← Главная
              </button>
            ) : null}
          </div>
          {animeTitle ? <p className="sh-search-anime">{animeTitle}</p> : null}
          <div className="sh-search-row">
            <input
              type="search"
              className="sh-input"
              placeholder="Поиск аниме…"
              value={query}
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={onSearchFocus}
              onBlur={() => {
                onSearchBlur();
                setQuery((q0) => normalizeSearchQuery(q0));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchNow();
                }
              }}
              aria-label="Поиск аниме"
            />
            <button
              type="button"
              className={`sh-btn primary${loadingSearch ? " loading" : ""}`}
              onClick={searchNow}
              disabled={loadingSearch || busy}
            >
              {loadingSearch ? <span className="sh-spinner" aria-hidden /> : null}
              Найти
            </button>
          </div>
        </div>

        {kodikNotConfigured ? (
          <div className="sh-card sh-kodik-notice" role="status">
            <p className="sh-kodik-notice-title">Kodik не подключён к API</p>
            <p className="sh-kodik-notice-text">
              Здесь не будет озвучек и серий, пока на сервере не реализованы эндпоинты Kodik.
            </p>
          </div>
        ) : null}

        {searchErr ? (
          <div className="sh-card sh-search-feedback">
            <div className="sh-status error" role="alert">
              {searchErr}
            </div>
          </div>
        ) : null}

        {!searchErr && searchDone && !loadingSearch && searchResults.length === 0 && normalizeSearchQuery(query) ? (
          <div className="sh-card sh-search-feedback">
            <div className="sh-status" role="status">
              Ничего не найдено. Попробуйте уточнить запрос.
            </div>
          </div>
        ) : null}

        {searchResults.length ? (
          <div className="sh-card sh-search-results" aria-label="Результаты поиска">
            <div className="sh-search-strip" role="list">
              {searchResults.map((r) => {
                const title = r.title || `#${r.anime_id}`;
                const poster = r.poster;
                const active = animeId != null && Number(animeId) === Number(r.anime_id);
                return (
                  <button
                    key={`sr-${r.anime_id}`}
                    type="button"
                    role="listitem"
                    className={`sh-search-card${active ? " active" : ""}`}
                    onClick={() => void openAnimeFromSearchResult(r)}
                    disabled={busy || loadingBootstrap}
                    title={title}
                  >
                    <span className="sh-search-poster" aria-hidden>
                      {poster ? (
                        <img src={poster} alt="" width={52} height={74} className="sh-search-img" />
                      ) : (
                        <span className="sh-search-poster-ph" />
                      )}
                    </span>
                    <span className="sh-search-main">
                      <span className="sh-search-title">{title}</span>
                      {r.original_title && r.original_title !== title ? (
                        <span className="sh-search-sub">{r.original_title}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="sh-card sh-player-card">
          <div className="sh-stage sh-stage--mylist-collapsed">
            <div className="sh-video-pane">
              <div className="sh-video-wrap">
                <div className="sh-current-episode-badge" aria-live="polite">
                  Серия {Math.max(1, Math.floor(Number(episode) || 1))}
                </div>
                <video
                  ref={videoRef}
                  id="video"
                  playsInline
                  autoPlay
                  muted={shouldAutoplayMuted()}
                  preload="auto"
                  aria-label="Видео эпизода"
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onCanPlay={() => setBuffering(false)}
                  onLoadedMetadata={onVideoTimelineRefreshed}
                  onDurationChange={onVideoTimelineRefreshed}
                />
                {showVideoBufferHint ? (
                  <div className="sh-video-buffer-hint" role="status" aria-live="polite">
                    <span className="sh-video-buffer-spinner" aria-hidden />
                    <span>Буферизация…</span>
                  </div>
                ) : null}
                {(showLoadOverlay) ? (
                  <div className="sh-anime-load-overlay" role="status" aria-live="polite" aria-busy="true">
                    <div className="sh-anime-load-bg" aria-hidden />
                    <div className="sh-anime-load-sparkles" aria-hidden>
                      <span className="sh-anime-spark sh-anime-spark--1" />
                      <span className="sh-anime-spark sh-anime-spark--2" />
                      <span className="sh-anime-spark sh-anime-spark--3" />
                      <span className="sh-anime-spark sh-anime-spark--4" />
                      <span className="sh-anime-spark sh-anime-spark--5" />
                      <span className="sh-anime-spark sh-anime-spark--6" />
                    </div>
                    <div className="sh-anime-load-mascot" aria-hidden>
                      {waitGifFailed ? (
                        <div className="sh-twan">
                          <div className="sh-twan-hair-back" />
                          <div className="sh-twan-neck" />
                          <div className="sh-twan-face">
                            <div className="sh-twan-blush sh-twan-blush--l" />
                            <div className="sh-twan-blush sh-twan-blush--r" />
                            <div className="sh-twan-eye sh-twan-eye--l" />
                            <div className="sh-twan-eye sh-twan-eye--r" />
                            <div className="sh-twan-mouth" />
                          </div>
                          <div className="sh-twan-hair-front" />
                          <div className="sh-twan-bow">
                            <span className="sh-twan-bow-knot" />
                          </div>
                          <div className="sh-twan-body" />
                        </div>
                      ) : (
                        <img
                          className="sh-wait-mascot-gif sh-wait-mascot-gif--hero"
                          src={waitGifUrl}
                          alt=""
                          width={200}
                          height={112}
                          decoding="async"
                          fetchPriority="high"
                          onError={() => setWaitGifFailed(true)}
                        />
                      )}
                    </div>
                    <p key={`ld-${loadPhraseI}`} className="sh-anime-load-caption sh-wait-caption-tick">
                      {WAIT_PHRASES_LOADER[loadPhraseI % WAIT_PHRASES_LOADER.length]}
                    </p>
                    <div className="sh-anime-load-dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : null}
                {buffering ? (
                  <div className="sh-buffer-overlay" role="status" aria-live="polite" aria-busy="true">
                    <div className="sh-buffer-overlay__bg" />
                    <div className="sh-buffer-overlay__sparkles">
                      <span className="sh-buf-spark sh-buf-spark--1" />
                      <span className="sh-buf-spark sh-buf-spark--2" />
                      <span className="sh-buf-spark sh-buf-spark--3" />
                    </div>
                    <div className="sh-buffer-overlay__inner">
                      {waitGifFailed ? (
                        <div className="sh-buf-chibi">
                          <div className="sh-buf-hair-back" />
                          <div className="sh-buf-face">
                            <div className="sh-buf-blush sh-buf-blush--l" />
                            <div className="sh-buf-blush sh-buf-blush--r" />
                            <div className="sh-buf-eye sh-buf-eye--l" />
                            <div className="sh-buf-eye sh-buf-eye--r" />
                            <div className="sh-buf-mouth" />
                          </div>
                          <div className="sh-buf-hair-front" />
                          <div className="sh-buf-bow" />
                        </div>
                      ) : (
                        <img
                          className="sh-wait-mascot-gif sh-wait-mascot-gif--buf"
                          src={waitGifUrl}
                          alt=""
                          width={120}
                          height={68}
                          decoding="async"
                          onError={() => setWaitGifFailed(true)}
                        />
                      )}
                      <span key={`bf-${bufPhraseI}`} className="sh-buf-caption sh-wait-caption-tick">
                        {WAIT_PHRASES_BUFFER[bufPhraseI % WAIT_PHRASES_BUFFER.length]}
                      </span>
                      <div className="sh-buf-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  </div>
                ) : null}
                {needsPlayTap ? (
                  <button
                    type="button"
                    className="sh-play-tap-overlay"
                    aria-label="Начать воспроизведение"
                    onClick={() => {
                      setNeedsPlayTap(false);
                      const v = videoRef.current;
                      if (v) {
                        v.muted = false;
                        void v.play().catch(() => setNeedsPlayTap(true));
                      } else {
                        void playSelected();
                      }
                    }}
                  >
                    <span className="sh-play-tap-icon" aria-hidden>
                      ▶
                    </span>
                    <span className="sh-play-tap-text">
                      {inTelegram ? "Нажмите, чтобы смотреть" : "Воспроизвести"}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            {showStartupTrace && startupBreakdown !== "—" ? (
              <p className="sh-startup-trace" aria-live="polite">
                {startupBreakdown}
              </p>
            ) : null}

            {resumeHintSec != null && resumeHintSec > 0 ? (
              <div className="sh-resume-hint" role="status" aria-live="polite">
                <span>
                  {resumeHintEpisode != null
                    ? formatResumeHint(resumeHintEpisode, resumeHintSec)
                    : `Продолжаем с ${formatClockSec(resumeHintSec)}`}
                </span>
                <button
                  type="button"
                  className="sh-btn"
                  onClick={() => {
                    const v = videoRef.current;
                    const id = Number(animeId) || 0;
                    const tid = String(translationId || "");
                    const ep = Math.floor(Number(episode) || 1);
                    if (v) {
                      try {
                        v.currentTime = 0;
                        flushWatchProgress(id, tid, ep, 0);
                      } catch {
                        /* */
                      }
                    }
                    setResumeHintSec(null);
                    setResumeHintEpisode(null);
                  }}
                >
                  С начала
                </button>
                <button
                  type="button"
                  className="sh-btn primary"
                  onClick={() => {
                    setResumeHintSec(null);
                    setResumeHintEpisode(null);
                  }}
                >
                  OK
                </button>
              </div>
            ) : null}

            <div className="sh-player-bar" aria-label="Управление плеером">
              <div className="sh-player-bar-group">
                <span className="sh-player-bar-label">Пропуск</span>
                <div className="sh-skip-group">
                  <button
                    type="button"
                    className="sh-mini-btn"
                    disabled={!skipUi.canOpening}
                    title={
                      skipUi.showNoMarkersHint
                        ? "Таймкоды OP/ED не переданы API"
                        : !skipMarkers?.openingEndSec
                          ? "Нет таймкода конца опенинга"
                          : "Пропустить опенинг"
                    }
                    aria-label="Пропустить опенинг"
                    onClick={() => skipOpening()}
                  >
                    OP
                  </button>
                  <button
                    type="button"
                    className="sh-mini-btn"
                    disabled={!skipUi.canEnding}
                    title={
                      skipUi.showNoMarkersHint
                        ? "Таймкоды OP/ED не переданы API"
                        : skipUi.endingNeedsMeta
                          ? "Дождитесь метаданных длительности"
                          : "Пропустить эндинг"
                    }
                    aria-label="Пропустить эндинг"
                    onClick={() => skipEnding()}
                  >
                    ED
                  </button>
                </div>
              </div>
              <div className="sh-player-bar-group">
                <span className="sh-player-bar-label">Серия</span>
                <div className="sh-skip-group">
                  <button
                    type="button"
                    className="sh-mini-btn"
                    onClick={goPrevEpisode}
                    disabled={!canPrevEpisode || loadingBootstrap}
                    aria-label="Предыдущая серия"
                    title="Предыдущая серия"
                  >
                    ◀ Prev
                  </button>
                  <button type="button" className="sh-mini-btn sh-episode-now" disabled>
                    #{Math.max(1, Math.floor(Number(episode) || 1))}
                  </button>
                  <button
                    type="button"
                    className="sh-mini-btn"
                    onClick={goNextEpisode}
                    disabled={!canNextEpisode || loadingBootstrap}
                    aria-label="Следующая серия"
                    title="Следующая серия"
                  >
                    Next ▶
                  </button>
                </div>
              </div>
              <div className="sh-player-bar-group">
                <span className="sh-player-bar-label">Качество</span>
                <select
                  className="sh-quality-select"
                  aria-label="Качество видео"
                  value={activeQuality === "" ? "" : String(activeQuality)}
                  disabled={qualitySelectDisabled}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) void switchQuality(next);
                  }}
                >
                  {qualityOptions.length === 0 ? (
                    <option value="">—</option>
                  ) : (
                    [...qualityOptions]
                      .sort((a, b) => b - a)
                      .map((q) => (
                        <option key={q} value={q}>
                          {q}p
                        </option>
                      ))
                  )}
                </select>
              </div>
              {qualitySelectDisabled && hlsNativeQualityLock ? (
                <p className="sh-player-bar-hint">В Safari качество выбирает система</p>
              ) : null}
            </div>
          </div>

          {geoBlocked ? (
            <p className="sh-viewer-alert" role="alert">
              Этот тайтл недоступен в вашем регионе.
            </p>
          ) : null}
          {videoErr ? (
            <div className={`sh-status error`} role="alert">
              {videoErr}
              <span style={{ display: "block", marginTop: 8 }}>
                <button type="button" className="sh-btn" onClick={() => void playSelected()}>
                  Повторить
                </button>
              </span>
            </div>
          ) : null}
        </div>

        <div className="sh-card sh-episodes-bar">
          <div className="sh-trbar" aria-label="Озвучка">
            <div className="sh-trbar-head">
              <strong>ОЗВУЧКА</strong>
              <div className="sh-tr-meta">
                <span id="trCount">{translationsFiltered.length}</span>
                {translationsCount > 0 && translationsFiltered.length !== translationsCount ? (
                  <span className="sh-tr-meta-total"> / {translationsCount}</span>
                ) : null}
              </div>
            </div>
            {translationsCount > 0 ? (
              <div className="sh-trbar-controls">
                <input
                  id="trSearch"
                  className="sh-input sh-trbar-search"
                  placeholder="Поиск студии…"
                  value={trSearch}
                  onChange={(e) => setTrSearch(e.target.value)}
                  aria-label="Фильтр озвучек"
                />
              </div>
            ) : null}
            <div className="sh-tr-strip" aria-label="Список озвучек">
              {geoBlocked ? (
                <div className="sh-tr-placeholder">Озвучки недоступны в вашем регионе.</div>
              ) : showTranslationsLoading ? (
                <div className="sh-tr-placeholder">Загружаю озвучки…</div>
              ) : showTranslationsEmpty ? (
                <div className="sh-tr-placeholder">Озвучки не найдены для этого тайтла.</div>
              ) : translationsForStrip.length === 0 && translationsCount > 0 ? (
                <div className="sh-tr-placeholder">Нет совпадений по фильтру.</div>
              ) : (
                translationsForStrip.map((t) => {
                  const id = translationRowIdString(t);
                  const active = String(translationId) === id;
                  const label = formatTranslationLabel(t);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`sh-tr-chip${active ? " active" : ""}`}
                      onClick={() => selectTranslation(id)}
                      disabled={loadingBootstrap}
                      title={label}
                      aria-label={`Озвучка: ${label}`}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className="sh-tr-chip-title">{label}</span>
                      <span className="sh-tr-chip-go" aria-hidden>
                        ▶
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="sh-episodes-head">
            <strong>СЕРИИ</strong>
            <div className="sh-episodes-head-actions">
              <div className="sh-episodes-meta" id="episodesMeta">
                {episodesMeta}
              </div>
              <div className="sh-episodes-nav">
                <button
                  type="button"
                  className="sh-mini-btn"
                  onClick={goPrevEpisode}
                  disabled={!canPrevEpisode || loadingBootstrap}
                  aria-label="Предыдущая серия"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="sh-mini-btn"
                  onClick={goNextEpisode}
                  disabled={!canNextEpisode || loadingBootstrap}
                  aria-label="Следующая серия"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>
          <form
            className="sh-episodes-jump"
            onSubmit={(e) => {
              e.preventDefault();
              goToEpisodeFromInput();
            }}
          >
            <label className="sh-episodes-jump-label" htmlFor="episodeJump">
              Перейти к серии
            </label>
            <input
              id="episodeJump"
              className="sh-input sh-episodes-jump-input"
              inputMode="numeric"
              placeholder="№"
              value={episodeJumpInput}
              onChange={(e) => setEpisodeJumpInput(e.target.value)}
              aria-describedby={episodeJumpHint ? "episodeJumpHint" : undefined}
            />
            <button type="submit" className="sh-btn sh-episodes-jump-btn">
              Перейти
            </button>
            {episodeJumpHint ? (
              <span
                id="episodeJumpHint"
                className={`sh-episodes-jump-hint${episodeJumpHint.error ? " error" : ""}`}
                role="status"
              >
                {episodeJumpHint.text}
              </span>
            ) : null}
          </form>
          <div className="sh-episodes-strip" id="episodesStrip">
            {showEpisodesLoading ? (
              <div className="sh-tr-placeholder">Загружаю серии…</div>
            ) : episodeOptions.length === 0 ? (
              <div className="sh-tr-placeholder">Серии недоступны для этой озвучки.</div>
            ) : (
              episodeOptions.map((o) => (
                <button
                  id={`ep-strip-btn-${o.value}`}
                  key={o.value}
                  type="button"
                  className={`sh-ep-btn${String(episode) === o.value ? " active" : ""}`}
                  disabled={o.disabled}
                  aria-label={`Серия ${o.value}`}
                  aria-current={String(episode) === o.value ? "true" : undefined}
                  onClick={() => {
                    if (o.disabled) return;
                    onPickEpisode(Number(o.value) || 1);
                  }}
                >
                  {o.value}
                </button>
              ))
            )}
          </div>
        </div>

        {chronologyErr ? (
          <div className="sh-card sh-search-feedback">
            <div className="sh-status error" role="alert">
              Хронология: {chronologyErr}
            </div>
          </div>
        ) : null}
        {chronologyLoading && !chronology.length ? (
          <div className="sh-card sh-search-feedback">
            <div className="sh-status" role="status">
              Загружаю хронологию…
            </div>
          </div>
        ) : null}
        {renderChronologyStrip(chronologyTv, "TV", "tv")}
        {renderChronologyStrip(chronologyOther, "Прочее", "other")}

        {showDebug ? (
          <div className="sh-card sh-debug">
            <div className="sh-pill">
              <strong>Статус:</strong> <span id="status">{status.text}</span>
            </div>
            <div className="sh-pill">
              <strong>Endpoint:</strong> <code id="endpoint">{endpoint}</code>
            </div>
            <div className="sh-pill">
              <strong>Озвучка:</strong> <span id="debugTranslation">{activeTranslationLabelForDebug}</span>
            </div>
            <div className="sh-pill">
              <strong>Позиция:</strong> <span id="debugPlayback">{playbackDebugText}</span>
            </div>
            <div className="sh-pill">
              <strong>Старт:</strong> <span id="debugStartup">{startupBreakdown}</span>
            </div>
            <pre id="debugJson" aria-label="debug json">
              {typeof debugJson === "string" ? debugJson : JSON.stringify(debugJson, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}
