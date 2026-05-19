import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";
import type Plyr from "plyr";
import { useTelegramWebApp } from "./hooks/useTelegramWebApp";
import { useSearchParams } from "./hooks/useSearchParams";
import { parseLaunchShikiId } from "./telegramWebApp";
import { shouldShowDebugPanel } from "./lib/showDebug";
import {
  availableQualities,
  buildEpisodesOptions,
  buildKodikEpisodesPayloadFromWatch,
  formatTranslationLabel,
  inferQualityFromUrl,
  pickFirstTranslationId,
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
  type KodikSkipMarkers,
} from "./lib/kodikSkip";

type WatchPayload = {
  /** URL страницы плеера Kodik с `/watch` — для preconnect и сборки kodik_embed_url на бэкенде. */
  player_url?: string;
  translations?: TranslationRow[];
  series_count?: number;
  unavailable_reason?: string;
  message?: string;
};

type EpisodesPayload = Parameters<typeof buildEpisodesOptions>[0];

type KodikLinkResponse = {
  player_url?: string;
  /** Готовый URL iframe: поток с CDN Kodik без прокси Suteki Hub (быстрый режим). */
  kodik_embed_url?: string;
  kodik_max_quality?: number | null;
  hls_manifest_url?: string;
  prefer_hls?: boolean;
  /** Если Kodik/бэкенд начнут отдавать таймкоды — подхватятся в `pickSkipMarkersFromKodikLink`. */
  opening_end_sec?: number | null;
  op_end_sec?: number | null;
  skip_opening_to_sec?: number | null;
  ending_start_sec?: number | null;
  ed_start_sec?: number | null;
  ending_skip_to_sec?: number | null;
  skip_ending_to_sec?: number | null;
};

type ChronologyItem = {
  anime_id: number;
  title: string;
  original_title?: string | null;
  poster?: string | null;
  kind?: string | null;
  year?: number | null;
  date?: string | null;
};

const MY_LIST_SEED: Array<{ titleRu: string }> = [
  { titleRu: "Стальной алхимик: Братство" },
  { titleRu: "Атака титанов" },
  { titleRu: "Тетрадь смерти" },
  { titleRu: "Врата Штейна" },
  { titleRu: "Охотник х Охотник" },
  { titleRu: "Гинтама" },
  { titleRu: "Ван-Пис" },
  { titleRu: "Клинок, рассекающий демонов" },
  { titleRu: "Магическая битва" },
  { titleRu: "Код Гиас: Восставший Лелуш" },
  { titleRu: "Монстр" },
  { titleRu: "Сага о Винланде" },
  { titleRu: "Моб Психо 100" },
  { titleRu: "Ковбой Бибоп" },
  { titleRu: "Самурай Чамплу" },
  { titleRu: "Евангелион" },
  { titleRu: "Созданный в Бездне" },
  { titleRu: "Твоя апрельская ложь" },
  { titleRu: "Кланнад: Продолжение истории" },
];

type MyListResolved = {
  anime_id: number;
  title: string;
  poster?: string | null;
  original_title?: string | null;
};

const MY_LIST_RESOLVE_CACHE_KEY = "suteki:my_list:resolved:v1";
const MY_LIST_ITEMS_KEY = "suteki:my_list:items:v1";

const SEARCH_DEBOUNCE_MS = 420;

function readMyListCache(): Record<string, MyListResolved> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(MY_LIST_RESOLVE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, MyListResolved>;
  } catch {
    return {};
  }
}

function writeMyListCache(next: Record<string, MyListResolved>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(MY_LIST_RESOLVE_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy mode
  }
}

function readMyListItems(): MyListResolved[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MY_LIST_ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object")
      .map((x) => x as MyListResolved)
      .filter((x) => Number.isFinite(Number(x.anime_id)) && Number(x.anime_id) > 0);
  } catch {
    return [];
  }
}

function writeMyListItems(next: MyListResolved[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MY_LIST_ITEMS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function normalizeSearchQuery(raw: string): string {
  const s = String(raw || "");
  return s
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Человекочитаемое время для строки отладки плеера (m:ss или h:mm:ss). */
function formatClockSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * hls.js tuning for VOD over proxied Kodik segments: quicker first frame, stable forward buffer,
 * cap quality to player size, conservative initial bandwidth estimate for ABR.
 */
const HLS_VOD_OPTIONS = {
  enableWorker: true,
  lowLatencyMode: false,
  startFragPrefetch: true,
  capLevelToPlayerSize: true,
  maxBufferLength: 50,
  maxMaxBufferLength: 120,
  backBufferLength: 40,
  abrEwmaDefaultEstimate: 1_000_000,
} as const;

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
  const showDebug = shouldShowDebugPanel();

  const launchShiki = parseLaunchShikiId();
  const qpAnime = searchParams.get("anime_id") || searchParams.get("shiki_id");
  const parsedAnimeId =
    launchShiki ??
    (qpAnime && !Number.isNaN(Number(qpAnime)) && Number(qpAnime) > 0 ? Math.floor(Number(qpAnime)) : null);
  const qpTid = searchParams.get("translation_id");
  const qpEp = searchParams.get("episode");
  const parsedEp =
    qpEp && !Number.isNaN(Number(qpEp)) && Number(qpEp) > 0 ? Math.floor(Number(qpEp)) : 1;

  const defaultQ = searchParams.get("q") || "наруто";

  const [query, setQuery] = useState(defaultQ);
  const [animeId, setAnimeId] = useState<number | null>(parsedAnimeId);
  const [translationId, setTranslationId] = useState<string | null>(qpTid ? String(qpTid) : null);
  const [episode, setEpisode] = useState(parsedEp);
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
  const [searchResults, setSearchResults] = useState<MyListResolved[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  /** false = встроенный плеер Kodik (iframe, прямой CDN); true = Plyr+hls.js через наш прокси. */
  const [useNativePlayer, setUseNativePlayer] = useState(false);
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [embedAvailable, setEmbedAvailable] = useState(false);
  const [hlsMode, setHlsMode] = useState(false);
  /** Safari / native HLS: no hls.js instance — quality control API unavailable. */
  const [hlsNativeQualityLock, setHlsNativeQualityLock] = useState(false);
  const [skipMarkers, setSkipMarkers] = useState<KodikSkipMarkers | null>(null);
  const [playableEndKnown, setPlayableEndKnown] = useState(false);
  const [episodeJumpInput, setEpisodeJumpInput] = useState("");
  const [episodeJumpHint, setEpisodeJumpHint] = useState<{ text: string; error: boolean } | null>(null);
  /** Пустой первый кадр на сервере и при гидрации; данные из storage — в `useEffect` ниже. */
  const [myListResolved, setMyListResolved] = useState<Record<string, MyListResolved>>({});
  const [myListItems, setMyListItems] = useState<MyListResolved[]>([]);
  const [myListAddOpen, setMyListAddOpen] = useState(false);
  const [myListOpen, setMyListOpen] = useState(true);
  const [myListAddQuery, setMyListAddQuery] = useState("");
  const [myListAddLoading, setMyListAddLoading] = useState(false);
  const [myListAddErr, setMyListAddErr] = useState<string | null>(null);
  const [myListAddResults, setMyListAddResults] = useState<MyListResolved[]>([]);
  const [chronology, setChronology] = useState<ChronologyItem[]>([]);
  const [chronologyLoading, setChronologyLoading] = useState(false);
  const [chronologyErr, setChronologyErr] = useState<string | null>(null);
  /** Для блока отладки: позиция в своём плеере (не iframe Kodik). */
  const [playbackDebug, setPlaybackDebug] = useState({
    current: 0,
    duration: Number.NaN,
    paused: true,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const episodeJumpHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsImportRef = useRef<Promise<typeof import("hls.js")> | null>(null);
  const searchReqIdRef = useRef(0);
  const lastDebouncedQueryRef = useRef<string>("");
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

  // (was) primary + carousel split; now we render one horizontal strip

  const episodeOptions = useMemo(() => buildEpisodesOptions(episodes), [episodes]);

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

  const apiJson = useCallback(
    async (url: string) => {
      setEndpoint(url);
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json().catch(() => ({}));
      if (showDebug) console.log("API:", url, j);
      applyDebug(j);
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        if (j && typeof j === "object" && j !== null && "detail" in j) {
          const d = (j as { detail?: unknown }).detail;
          if (typeof d === "string") msg = d;
          else if (d && typeof d === "object" && d !== null && "message" in d) {
            msg = String((d as { message?: string }).message || msg);
          }
        }
        throw new Error(msg);
      }
      return j;
    },
    [applyDebug, showDebug],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("plyr");
      if (cancelled || !videoRef.current) return;
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
        settings: ["speed"],
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      });
    })();
    return () => {
      cancelled = true;
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

  useEffect(() => {
    queueMicrotask(() => {
      setMyListResolved(readMyListCache());
      setMyListItems(readMyListItems());
    });
  }, []);

  const loadEpisodes = useCallback(
    async (id: number, tid: string) => {
      setStatus("получаю /episodes (список серий)…");
      const eps = (await apiJson(
        `/api/v1/anime/${encodeURIComponent(id)}/episodes?provider=kodik&translation_id=${encodeURIComponent(tid)}`,
      )) as EpisodesPayload;
      setEpisodes(eps);
      return eps;
    },
    [apiJson, setStatus],
  );

  /** Загрузка watch + episodes. preferredTid: эта озвучка или первая из ответа. Возвращает translation_id при успехе. */
  const bootstrapAnime = useCallback(
    async (id: number, preferredTid: string | null): Promise<string | null> => {
      setLoadingBootstrap(true);
      setBusy(true);
      setGeoBlocked(false);
      try {
        ensureHlsPreloaded();
        setStatus("получаю /watch (translations)…");
        const w = (await apiJson(
          `/api/v1/anime/${encodeURIComponent(id)}/watch?player=kodik`,
        )) as WatchPayload;
        setWatch(w);

        if (w?.unavailable_reason === "geo") {
          setStatus("Kodik geo-блокирован для этого тайтла в текущей сети/регионе.", { error: true });
          setGeoBlocked(true);
          return null;
        }

        if (w?.unavailable_reason === "not_configured" || w?.unavailable_reason === "init") {
          setGeoBlocked(false);
          const hint =
            typeof w.message === "string" && w.message.trim()
              ? w.message.trim()
              : "Kodik не подключён к этому серверу: озвучки и видео недоступны. Откройте каталог на главной — поиск через Shikimori работает без Kodik.";
          setStatus(hint, { error: false });
          setTranslationId(null);
          setEpisodes(null);
          return null;
        }

        const ids = new Set((w.translations || []).filter((t) => translationRowHasId(t)).map((t) => translationRowIdString(t)));
        const tid =
          preferredTid && ids.has(preferredTid) ? preferredTid : pickFirstTranslationId(w);
        setTranslationId(tid);
        if (!tid) {
          const apiHint =
            typeof w.message === "string" && w.message.trim() ? ` ${w.message.trim()}` : "";
          setStatus(
            `Не нашёл озвучки в ответе /watch.${apiHint || " Возможно, Kodik недоступен для этого тайтла."}`,
            { error: true },
          );
          return null;
        }

        if (translationHasSeriesRangeForTranslationId(w, tid)) {
          setStatus("строю список серий из /watch…");
          setEpisodes(buildKodikEpisodesPayloadFromWatch(w, tid, 12));
        } else {
          await loadEpisodes(id, tid);
        }
        setEpisode((e) => (Number.isFinite(e) && e > 0 ? e : 1));
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
    [apiJson, ensureHlsPreloaded, loadEpisodes, setStatus],
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
    async (opts: { animeId: number; translationId: string; episode: number; resumeAfterLoadSec?: number | null }) => {
      const { animeId: id, translationId: tid, episode: ep, resumeAfterLoadSec } = opts;
      const resumeSec =
        resumeAfterLoadSec != null && Number.isFinite(resumeAfterLoadSec) && resumeAfterLoadSec > 0.25
          ? resumeAfterLoadSec
          : null;
      ensureHlsPreloaded();
      setVideoErr(null);
      setBusy(true);
      try {
        setStatus("запрашиваю /kodik/link…");
        const out = (await apiJson(
          `/api/v1/anime/${encodeURIComponent(id)}/kodik/link?episode=${encodeURIComponent(ep)}&translation_id=${encodeURIComponent(tid)}`,
        )) as KodikLinkResponse;

        setSkipMarkers(pickSkipMarkersFromKodikLink(out));

        const mp4 = out && typeof out.player_url === "string" ? out.player_url.trim() : "";
        if (!mp4) {
          setStatus("В ответе нет player_url.", { error: true });
          return;
        }

        const embedWatch = typeof out.kodik_embed_url === "string" ? out.kodik_embed_url.trim() : "";
        setEmbedAvailable(Boolean(embedWatch));

        destroyHls();
        setEmbedSrc(null);

        if (embedWatch && !useNativePlayer) {
          setEmbedSrc(embedWatch);
          setRawMp4(mp4);
          setHlsMode(false);
          setHlsNativeQualityLock(false);
          try {
            videoRef.current?.pause();
          } catch {
            /* */
          }
          setStatus("готово (плеер Kodik).");
          return;
        }

        const v = videoRef.current;
        if (!v) return;

        const hlsRaw = typeof out.hls_manifest_url === "string" ? out.hls_manifest_url.trim() : "";
        const preferHls = Boolean(out.prefer_hls) || mp4.includes("/s/m/");
        let startedHls = false;

        const onVideoError = () => {
          const err = v.error;
          const code = err && typeof err.code === "number" ? err.code : 0;
          const src = String(v.currentSrc || v.src || "").slice(0, 220);
          setVideoErr(`Ошибка видео (code=${code}). src=${src || "—"}.`);
          setStatus(`Ошибка видео (code=${code}). src=${src || "—"}.`, { error: true });
        };

        if (preferHls && hlsRaw) {
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
            const hls = new HlsMod({ ...HLS_VOD_OPTIONS });
            hlsRef.current = hls;
            hls.loadSource(manifestSrc);
            hls.attachMedia(v);
            hls.on(HlsMod.Events.MANIFEST_PARSED, () => {
              const pick = buildHlsQualityPick(hls.levels);
              hlsQualityPickRef.current = pick;
              setQualityOptions(pick.heights);
              const ci = hls.currentLevel;
              if (ci >= 0 && pick.levelIdxs.includes(ci)) {
                const oi = pick.levelIdxs.indexOf(ci);
                setSelectedQuality(pick.heights[oi] ?? pick.heights[0] ?? "");
              } else if (ci >= 0 && hls.levels[ci]) {
                const h = estimateHeightFromHlsLevel(hls.levels[ci]);
                setSelectedQuality(pick.heights.includes(h) ? h : (pick.heights[0] ?? ""));
              } else {
                setSelectedQuality(pick.heights[0] ?? "");
              }
              setStatus("загружаю поток…");
            });
            const hlsForPlay = hls;
            const onHlsCanPlay = () => {
              if (hlsRef.current !== hlsForPlay) return;
              if (resumeSec != null) {
                try {
                  const d = v.duration;
                  const target = Number.isFinite(d) && d > 0 ? Math.min(resumeSec, Math.max(0, d - 0.25)) : resumeSec;
                  if (target > 0.25) v.currentTime = target;
                } catch {
                  /* */
                }
              }
              setStatus("готово к воспроизведению (HLS).");
              void v.play().catch(() => {});
            };
            v.addEventListener("canplay", onHlsCanPlay, { once: true });
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
              if (data.fatal) {
                const detail = `${data.type} ${data.details}`;
                setVideoErr(`HLS: ${detail}`);
                setStatus(`Ошибка HLS: ${detail}`, { error: true });
              }
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
            const onCanPlayHls = () => {
              v.removeEventListener("canplay", onCanPlayHls);
              if (resumeSec != null) {
                try {
                  const d = v.duration;
                  const target = Number.isFinite(d) && d > 0 ? Math.min(resumeSec, Math.max(0, d - 0.25)) : resumeSec;
                  if (target > 0.25) v.currentTime = target;
                } catch {
                  /* */
                }
              }
              setStatus("готово к воспроизведению (HLS).");
              void v.play().catch(() => {});
            };
            v.addEventListener("canplay", onCanPlayHls);
            startedHls = true;
          }
        }

        if (!startedHls) {
          setHlsMode(false);
          setupQualityFromLink(out, mp4);
          setStatus("загружаю MP4…");
          setRawMp4(mp4);
          v.pause();
          v.src = proxifyMediaUrl(mp4);
          v.load();

          const onCanPlay = () => {
            v.removeEventListener("canplay", onCanPlay);
            if (resumeSec != null) {
              try {
                const d = v.duration;
                const target = Number.isFinite(d) && d > 0 ? Math.min(resumeSec, Math.max(0, d - 0.25)) : resumeSec;
                if (target > 0.25) v.currentTime = target;
              } catch {
                /* */
              }
            }
            setStatus("готово к воспроизведению.");
            void v.play().catch(() => {});
          };
          v.addEventListener("canplay", onCanPlay);
          v.onerror = onVideoError;
        }
      } catch (e) {
        console.error(e);
        setStatus(`Не удалось запустить: ${String(e instanceof Error ? e.message : e)}`, { error: true });
      } finally {
        setBusy(false);
      }
    },
    [apiJson, destroyHls, ensureHlsPreloaded, setStatus, setupQualityFromLink, useNativePlayer],
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
      await playStream({ animeId: id, translationId: tid, episode: ep });
    },
    [animeId, episode, playStream, setStatus, translationId],
  );

  useEffect(() => {
    if (!parsedAnimeId) return;
    void (async () => {
      try {
        setStatus("загрузка по ссылке…");
        const tid = await bootstrapAnime(parsedAnimeId, qpTid ? String(qpTid) : null);
        if (tid) {
          await playStream({
            animeId: parsedAnimeId,
            translationId: tid,
            episode: parsedEp,
          });
        }
      } catch (e) {
        console.error(e);
        setStatus(`Ошибка по ссылке: ${String(e instanceof Error ? e.message : e)}`, { error: true });
      }
    })();
  }, [parsedAnimeId, qpTid, parsedEp, bootstrapAnime, playStream, setStatus]);

  const selectTranslation = useCallback(
    (tid: string) => {
      if (!animeId) return;
      void (async () => {
        try {
          const iframeKodik = !useNativePlayer && Boolean(embedSrc);
          const v = videoRef.current;
          const resumeAfterLoadSec =
            !iframeKodik && v && Number.isFinite(v.currentTime) && v.currentTime > 0.25 ? v.currentTime : null;
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
          await Promise.all([pEpisodes, pPlay]);
        } catch (err) {
          console.error(err);
          setStatus(`Не удалось обновить серии: ${String(err instanceof Error ? err.message : err)}`, {
            error: true,
          });
        }
      })();
    },
    [animeId, embedSrc, episode, loadEpisodes, playStream, setStatus, useNativePlayer, watch],
  );

  const switchQuality = useCallback(
    async (nextQ: number) => {
      if (!useNativePlayer && embedSrc) {
        setStatus("Качество задаётся в плеере Kodik или переключите «Свой».", { error: false });
        return;
      }
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
      const nextUrl = proxifyMediaUrl(nextRaw);
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
    [embedSrc, hlsMode, rawMp4, setStatus, useNativePlayer],
  );

  const kodikFrameMode = !useNativePlayer && Boolean(embedSrc);

  const qualitySelectDisabled = qualityOptions.length <= 1 || hlsNativeQualityLock || kodikFrameMode;

  const activeTranslationLabelForDebug = useMemo(() => {
    const trs = watch && Array.isArray(watch.translations) ? watch.translations : [];
    const tr = trs.find((x) => translationRowHasId(x) && translationRowIdString(x) === String(translationId));
    if (tr) return formatTranslationLabel(tr);
    if (translationId) return `id ${translationId}`;
    return "—";
  }, [watch, translationId]);

  const playbackDebugText = useMemo(() => {
    if (kodikFrameMode) return "плеер Kodik (iframe) — позицию страница не читает";
    const { current, duration, paused } = playbackDebug;
    const cur = formatClockSec(current);
    const dur = Number.isFinite(duration) && duration > 0 ? formatClockSec(duration) : "…";
    return `${cur} / ${dur}${paused ? " · пауза" : ""}`;
  }, [kodikFrameMode, playbackDebug]);

  useEffect(() => {
    if (kodikFrameMode) return;
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
  }, [kodikFrameMode]);

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
        const payload = (await apiJson(`/api/v1/anime/search?q=${encodeURIComponent(q)}&limit=12`)) as {
          results?: unknown;
        };
        const results = payload && Array.isArray(payload.results) ? (payload.results as MyListResolved[]) : [];
        const mapped = results
          .filter((r) => r && typeof r === "object" && Number((r as MyListResolved).anime_id) > 0)
          .map((r) => ({
            anime_id: Number((r as MyListResolved).anime_id),
            title: String((r as MyListResolved).title || ""),
            poster: (r as MyListResolved).poster ?? null,
            original_title: (r as MyListResolved).original_title ?? null,
          }));
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
    void runSearch(query || defaultQ);
  }, [defaultQ, query, runSearch]);

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
    async (row: MyListResolved) => {
      const newId = Number(row.anime_id);
      if (!Number.isFinite(newId) || newId <= 0) return;
      setBusy(true);
      setVideoErr(null);
      try {
        setAnimeId(newId);
        setAnimeTitle(row.title || "");
        setTranslationId(null);
        setEpisode(1);
        const tid = await bootstrapAnime(newId, null);
        if (tid) {
          await playStream({ animeId: newId, translationId: tid, episode: 1 });
        }
      } catch (e) {
        console.error(e);
        setVideoErr(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
      }
    },
    [bootstrapAnime, playStream],
  );

  useEffect(() => {
    const id = animeId != null ? Number(animeId) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChronologyLoading(true);
    setChronologyErr(null);
    void (async () => {
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
    })();
    return () => {
      cancelled = true;
    };
  }, [animeId, apiJson]);

  const resolveMyListItem = useCallback(
    async (titleRu: string): Promise<MyListResolved | null> => {
      const key = titleRu.trim();
      if (!key) return null;
      const cached = myListResolved[key];
      if (cached && Number.isFinite(cached.anime_id) && cached.anime_id > 0) return cached;
      try {
        const payload = (await apiJson(`/api/v1/anime/search?q=${encodeURIComponent(key)}&limit=10`)) as {
          results?: unknown;
        };
        const results = payload && Array.isArray(payload.results) ? (payload.results as MyListResolved[]) : [];
        const first = results.find((r) => r && typeof r === "object" && Number((r as MyListResolved).anime_id) > 0) || null;
        if (!first) return null;
        const resolved: MyListResolved = {
          anime_id: Number(first.anime_id),
          title: String(first.title || key),
          poster: first.poster ?? null,
          original_title: first.original_title ?? null,
        };
        setMyListResolved((prev) => {
          const next = { ...prev, [key]: resolved };
          writeMyListCache(next);
          return next;
        });
        return resolved;
      } finally {
      }
    },
    [apiJson, myListResolved],
  );

  const addMyListItem = useCallback((row: MyListResolved) => {
    const id = Number(row.anime_id);
    if (!Number.isFinite(id) || id <= 0) return;
    setMyListItems((prev) => {
      const exists = prev.some((x) => Number(x.anime_id) === id);
      const next = exists ? prev : [{ ...row, anime_id: id }, ...prev];
      writeMyListItems(next);
      return next;
    });
  }, []);

  const runMyListAddSearch = useCallback(async () => {
    const q = myListAddQuery.trim();
    if (!q) return;
    setMyListAddLoading(true);
    setMyListAddErr(null);
    try {
      const payload = (await apiJson(`/api/v1/anime/search?q=${encodeURIComponent(q)}&limit=12`)) as {
        results?: unknown;
      };
      const results = payload && Array.isArray(payload.results) ? (payload.results as MyListResolved[]) : [];
      setMyListAddResults(
        results
          .filter((r) => r && typeof r === "object" && Number((r as MyListResolved).anime_id) > 0)
          .map((r) => ({
            anime_id: Number((r as MyListResolved).anime_id),
            title: String((r as MyListResolved).title || ""),
            poster: (r as MyListResolved).poster ?? null,
            original_title: (r as MyListResolved).original_title ?? null,
          })),
      );
    } catch (e) {
      setMyListAddErr(String(e instanceof Error ? e.message : e));
      setMyListAddResults([]);
    } finally {
      setMyListAddLoading(false);
    }
  }, [apiJson, myListAddQuery]);

  const openAnimeFromMyListId = useCallback(
    async (row: MyListResolved) => {
      const newId = Number(row.anime_id);
      if (!Number.isFinite(newId) || newId <= 0) return;
      setBusy(true);
      try {
        setStatus(`открываю «${row.title || `#${newId}`}»…`);
        setAnimeId(newId);
        setAnimeTitle(row.title || "");
        setTranslationId(null);
        setEpisode(1);
        const tid = await bootstrapAnime(newId, null);
        if (tid) {
          await playStream({ animeId: newId, translationId: tid, episode: 1 });
        }
      } catch (e) {
        console.error(e);
        setStatus(`Не удалось открыть: ${String(e instanceof Error ? e.message : e)}`, { error: true });
      } finally {
        setBusy(false);
      }
    },
    [bootstrapAnime, playStream, setStatus],
  );

  const navOpts = useMemo(() => episodeOptions.filter((x) => !x.disabled), [episodeOptions]);

  const hudText = useMemo(() => {
    const title = animeTitle || (animeId ? `#${animeId}` : "—");
    const tr = translationsFiltered.find((x) => translationRowIdString(x) === String(translationId));
    const trName = tr ? formatTranslationLabel(tr) : translationId ? `id=${translationId}` : "—";
    const tid = trName ? `озвучка: ${trName}` : "озвучка —";
    const ep = episode ? `серия ${episode}` : "серия —";
    return `${title} • ${tid} • ${ep}`;
  }, [animeId, animeTitle, episode, translationId, translationsFiltered]);

  const onPickEpisode = useCallback((n: number) => {
    const ep = Number(n) || 1;
    void playSelected(ep);
  }, [playSelected]);

  const showEpisodeJumpHint = useCallback((text: string, error: boolean) => {
    if (episodeJumpHintTimerRef.current) clearTimeout(episodeJumpHintTimerRef.current);
    setEpisodeJumpHint({ text, error });
    episodeJumpHintTimerRef.current = setTimeout(() => {
      setEpisodeJumpHint(null);
      episodeJumpHintTimerRef.current = null;
    }, 3200);
  }, []);

  const scrollEpisodeButtonIntoView = useCallback((n: number) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`ep-strip-btn-${n}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
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

  const kodikNotConfigured =
    watch?.unavailable_reason === "not_configured" || watch?.unavailable_reason === "init";

  return (
    <main className="sh-page" aria-busy={busy || loadingBootstrap || loadingSearch}>
      <div className="sh-shell">
        <div className="sh-card sh-header">
          <nav className="sh-nav" aria-label="Меню">
            <a href="/" className="sh-nav-link">
              Главная
            </a>
          </nav>
          <p className="sh-title">Просмотр</p>
          <p className="sh-subtitle">
            <a href="/">Главная</a>
          </p>
        </div>

        {kodikNotConfigured ? (
          <div className="sh-card sh-kodik-notice" role="status">
            <p className="sh-kodik-notice-title">Kodik не подключён к API</p>
            <p className="sh-kodik-notice-text">
              Здесь не будет озвучек и серий, пока на сервере не реализованы эндпоинты Kodik. Для просмотра описаний и
              постеров перейдите на{" "}
              <a href="/">главную</a>.
            </p>
          </div>
        ) : null}

        <div className="sh-card sh-toolbar">
          <input
            className="sh-input"
            placeholder='Поиск аниме (например: "наруто")'
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onBlur={() => setQuery((q0) => normalizeSearchQuery(q0))}
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
          <div className={`sh-stage${myListOpen ? "" : " sh-stage--mylist-collapsed"}`}>
            <aside className="sh-mylist" aria-label="Мой список аниме" aria-hidden={!myListOpen}>
              <div className="sh-mylist-header">
                <strong>МОЙ СПИСОК</strong>
                <div className="sh-mylist-actions">
                  <span className="sh-mylist-meta">{myListItems.length}</span>
                  <button
                    type="button"
                    className="sh-mini-btn sh-mylist-add"
                    onClick={() => setMyListAddOpen((v) => !v)}
                    disabled={busy}
                  >
                    Добавить
                  </button>
                  <button
                    type="button"
                    className="sh-mini-btn"
                    onClick={() => setMyListOpen(false)}
                    disabled={busy}
                    aria-label="Скрыть мой список"
                    title="Скрыть список"
                  >
                    Скрыть
                  </button>
                </div>
              </div>
              {myListAddOpen ? (
                <div className="sh-mylist-add">
                  <div className="sh-mylist-add-row">
                    <input
                      className="sh-input sh-mylist-add-input"
                      placeholder="Найти и добавить (Shikimori)…"
                      value={myListAddQuery}
                      onChange={(e) => setMyListAddQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void runMyListAddSearch()}
                      aria-label="Поиск для добавления в список"
                    />
                    <button
                      type="button"
                      className={`sh-btn primary${myListAddLoading ? " loading" : ""}`}
                      onClick={() => void runMyListAddSearch()}
                      disabled={busy || myListAddLoading}
                    >
                      {myListAddLoading ? <span className="sh-spinner" aria-hidden /> : null}
                      Найти
                    </button>
                  </div>
                  {myListAddErr ? <div className="sh-status error">{myListAddErr}</div> : null}
                  {myListAddResults.length ? (
                    <div className="sh-mylist-add-results" role="list" aria-label="Результаты поиска">
                      {myListAddResults.map((r) => (
                        <button
                          key={`add-${r.anime_id}`}
                          type="button"
                          role="listitem"
                          className="sh-mylist-add-item"
                          onClick={() => {
                            addMyListItem(r);
                            setMyListAddOpen(false);
                            setMyListAddResults([]);
                            setMyListAddQuery("");
                          }}
                        >
                          <span className="sh-mylist-add-item-main">
                            <span className="sh-mylist-add-item-title">{r.title}</span>
                            {r.original_title && r.original_title !== r.title ? (
                              <span className="sh-mylist-add-item-sub">{r.original_title}</span>
                            ) : null}
                          </span>
                          <span className="sh-mylist-add-item-go" aria-hidden>
                            +
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="sh-mylist-scroll" role="list">
                {myListItems.length === 0 ? (
                  <div className="sh-mylist-empty" role="status">
                    <div className="sh-mylist-empty-title">Пока пусто</div>
                    <div className="sh-mylist-empty-text">Нажмите «Добавить», чтобы найти тайтл в Shikimori и сохранить здесь.</div>
                    <button
                      type="button"
                      className="sh-btn"
                      onClick={async () => {
                        for (const s of MY_LIST_SEED) {
                          const r = await resolveMyListItem(s.titleRu);
                          if (r) addMyListItem(r);
                        }
                      }}
                      disabled={busy}
                    >
                      Заполнить примером
                    </button>
                  </div>
                ) : null}
                {myListItems.map((row) => {
                  const isActive = animeId != null && Number(row.anime_id) === Number(animeId);
                  const title = row.title || `#${row.anime_id}`;
                  const poster = row.poster;
                  return (
                    <div
                      key={`my-${row.anime_id}`}
                      role="listitem"
                      className={`sh-mylist-item${isActive ? " active" : ""}`}
                      tabIndex={0}
                      onClick={() => void openAnimeFromMyListId(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openAnimeFromMyListId(row);
                        }
                      }}
                    >
                      <div className="sh-mylist-poster" aria-hidden>
                        {poster ? (
                          <img src={poster} alt="" width={44} height={62} className="sh-mylist-img" />
                        ) : (
                          <div className="sh-mylist-poster-ph" />
                        )}
                      </div>
                      <div className="sh-mylist-main">
                        <div className="sh-mylist-title">{title}</div>
                        {row.original_title && row.original_title !== title ? (
                          <div className="sh-mylist-sub">{row.original_title}</div>
                        ) : null}
                      </div>
                      <div className="sh-mylist-go" aria-hidden>
                        ▶
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
            <div className="sh-video-pane">
              <div className={`sh-video-wrap${kodikFrameMode ? " sh-video-wrap-kodik" : ""}`}>
                <video
                  ref={videoRef}
                  id="video"
                  playsInline
                  preload="metadata"
                  className={kodikFrameMode ? "sh-video-backing" : undefined}
                  aria-label="Видео эпизода"
                  onWaiting={() => setBuffering(true)}
                  onPlaying={() => setBuffering(false)}
                  onCanPlay={() => setBuffering(false)}
                  onLoadedMetadata={onVideoTimelineRefreshed}
                  onDurationChange={onVideoTimelineRefreshed}
                />
                {kodikFrameMode && embedSrc ? (
                  <iframe
                    key={embedSrc}
                    title="Kodik"
                    className="sh-kodik-embed"
                    src={embedSrc}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : null}
                {buffering && !kodikFrameMode ? <div className="sh-buffer-overlay" aria-hidden /> : null}

                <div className="sh-hud-top">
                  <div className="sh-hud-pill">
                    <span id="hudText">{hudText}</span>
                  </div>
                  <div className="sh-hud-controls">
                    <button
                      type="button"
                      className={`sh-mini-btn${myListOpen ? " sh-mini-btn-active" : ""}`}
                      disabled={busy}
                      title={myListOpen ? "Скрыть список" : "Показать список"}
                      aria-label={myListOpen ? "Скрыть мой список" : "Показать мой список"}
                      onClick={() => setMyListOpen((v) => !v)}
                    >
                      Список
                    </button>
                    <div className="sh-player-mode-toggle" role="group" aria-label="Режим плеера">
                      <button
                        type="button"
                        className={`sh-mini-btn${!useNativePlayer && embedAvailable ? " sh-mini-btn-active" : ""}`}
                        disabled={busy || !embedAvailable}
                        title={
                          !embedAvailable
                            ? "Встроенный Kodik недоступен для этого ответа"
                            : "Плеер Kodik — как на сайте, без прокси (быстрее)"
                        }
                        onClick={() => {
                          setUseNativePlayer(false);
                          void playSelected();
                        }}
                      >
                        Kodik
                      </button>
                      <button
                        type="button"
                        className={`sh-mini-btn${useNativePlayer ? " sh-mini-btn-active" : ""}`}
                        disabled={busy}
                        title="Свой плеер Plyr и поток через API (качество, OP/ED)"
                        onClick={() => {
                          setUseNativePlayer(true);
                          void playSelected();
                        }}
                      >
                        Свой
                      </button>
                    </div>
                    <div className="sh-skip-group">
                      <button
                        type="button"
                        className="sh-mini-btn"
                        disabled={kodikFrameMode || !skipUi.canOpening}
                        title={
                          skipUi.showNoMarkersHint
                            ? "Kodik не передаёт таймкоды OP/ED в ответе ссылки; без opening_end_sec кнопка неактивна."
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
                        disabled={kodikFrameMode || !skipUi.canEnding}
                        title={
                          skipUi.showNoMarkersHint
                            ? "Kodik не передаёт таймкоды OP/ED в ответе ссылки."
                            : skipUi.endingNeedsMeta
                              ? "Дождитесь метаданных длительности (нужен конец ролика для пропуска эндинга)"
                              : "Пропустить эндинг"
                        }
                        aria-label="Пропустить эндинг"
                        onClick={() => skipEnding()}
                      >
                        ED
                      </button>
                      {skipMarkers && skipUi.showNoMarkersHint ? (
                        <span className="sh-skip-hint" title="В JSON /kodik/link нет полей opening_end_sec / ending_*">
                          нет таймкодов
                        </span>
                      ) : null}
                    </div>
                    <select
                      id="quality"
                      className="sh-quality-select"
                      disabled={qualitySelectDisabled}
                      value={selectedQuality === "" ? String(qualityOptions[0] ?? "") : String(selectedQuality)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v) void switchQuality(v);
                      }}
                      aria-label="Качество видео"
                    >
                      {qualityOptions.map((q) => (
                        <option key={q} value={q}>
                          {q}p
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
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
              </div>
            </div>
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
            <div className="sh-tr-strip" role="list" aria-label="Список озвучек">
              {translationsFiltered.map((t) => {
                const id = translationRowIdString(t);
                const active = String(translationId) === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    className={`sh-tr-chip${active ? " active" : ""}`}
                    onClick={() => selectTranslation(id)}
                    disabled={busy || loadingBootstrap}
                    title={formatTranslationLabel(t)}
                  >
                    <span className="sh-tr-chip-title">{formatTranslationLabel(t)}</span>
                    <span className="sh-tr-chip-go" aria-hidden>
                      ▶
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sh-episodes-head">
            <strong>СЕРИИ</strong>
            <div className="sh-episodes-meta" id="episodesMeta">
              {episodesMeta}
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
          <div className="sh-episodes-strip" id="episodesStrip" role="list">
            {episodeOptions.map((o) => (
              <button
                id={`ep-strip-btn-${o.value}`}
                key={o.value}
                type="button"
                role="listitem"
                className={`sh-ep-btn${String(episode) === o.value ? " active" : ""}`}
                disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return;
                  onPickEpisode(Number(o.value) || 1);
                }}
              >
                {o.value}
              </button>
            ))}
          </div>
        </div>

        <div className="sh-card sh-chronology" aria-label="Хронология">
          <div className="sh-chronology-head">
            <strong>ХРОНОЛОГИЯ</strong>
            <div className="sh-chronology-meta">
              {chronologyLoading ? "загрузка…" : chronology.length ? `${chronology.length}` : "—"}
            </div>
          </div>
          {chronologyErr ? <div className="sh-status error">{chronologyErr}</div> : null}
          {!chronologyErr && !chronologyLoading && chronology.length === 0 ? (
            <div className="sh-status" role="status">
              Нет данных для хронологии.
            </div>
          ) : null}
          {chronology.length ? (
            <div className="sh-chronology-strip" role="list" aria-label="Список по порядку">
              {chronology.map((c) => {
                const title = c.title || `#${c.anime_id}`;
                const poster = c.poster;
                const active = animeId != null && Number(animeId) === Number(c.anime_id);
                const meta = [c.kind ? String(c.kind).toUpperCase() : null, c.year ? String(c.year) : null]
                  .filter(Boolean)
                  .join(" • ");
                return (
                  <button
                    key={`ch-${c.anime_id}`}
                    type="button"
                    role="listitem"
                    className={`sh-chronology-card${active ? " active" : ""}`}
                    onClick={() =>
                      void openAnimeFromSearchResult({
                        anime_id: c.anime_id,
                        title,
                        poster: poster ?? null,
                        original_title: c.original_title ?? null,
                      })
                    }
                    disabled={busy || loadingBootstrap}
                    title={title}
                  >
                    <span className="sh-chronology-poster" aria-hidden>
                      {poster ? (
                        <img src={poster} alt="" width={52} height={74} className="sh-chronology-img" />
                      ) : (
                        <span className="sh-chronology-poster-ph" />
                      )}
                    </span>
                    <span className="sh-chronology-main">
                      <span className="sh-chronology-title">{title}</span>
                      {meta ? <span className="sh-chronology-sub">{meta}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

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
            <pre id="debugJson" aria-label="debug json">
              {typeof debugJson === "string" ? debugJson : JSON.stringify(debugJson, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}
