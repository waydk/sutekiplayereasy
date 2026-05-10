import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { WatchPanels } from "./WatchPanels";
import type { ChronologyEntry, ShikiAnimeBrief } from "./shikimoriApi";
import {
  displayTitle,
  episodeTotalFromShiki,
  fetchAnimeById,
  fetchChronology,
  kindLabel,
  searchAnimes,
} from "./shikimoriApi";
import { parseLaunchShikiId } from "./telegramWebApp";

type DubbingOption = { id: string; name: string; range: string };

type KodikSearchResult = {
  link?: string;
  translation?: { id?: number; title?: string; type?: string };
  title?: string;
  title_orig?: string;
  other_title?: string;
};

const LAST_SHIKI_ID_KEY = "suteki:player_easy:last_shiki_id:v1";
const LAST_SHIKI_SEARCH_KEY = "suteki:player_easy:last_shiki_search:v1";

const DEFAULT_KODIK_TOKEN = "56a768d08f43091901c44b54fe970049";

/** Маркер: под плеером показываем CTA на Telegram вместо строки статуса. */
const STATUS_TELEGRAM_CTA = "__suteki_telegram_cta__";

const TELEGRAM_CHANNEL_URL = "https://t.me/sutekianime";

function BrandTitle({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`sh-brand${compact ? " sh-brand--compact" : ""}`}
      aria-label="Suteki hub"
    >
      <span className="sh-brand-suteki">Suteki</span>
      <span className="sh-brand-hub">hub</span>
    </div>
  );
}

function safeInt(raw: string): number | null {
  const n = Math.floor(Number(String(raw || "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function safeUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

function appendParams(url: string, params: Record<string, string>): string {
  const u = safeUrl(url);
  if (!u) return "";
  try {
    const out = new URL(u);
    for (const [k, v] of Object.entries(params)) {
      if (!v) continue;
      out.searchParams.set(k, v);
    }
    return out.toString();
  } catch {
    return u;
  }
}

function readLS(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLS(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function dubbingFromKodik(results: KodikSearchResult[], episodeTotal: number): DubbingOption[] {
  const map = new Map<number, KodikSearchResult>();
  for (const r of results) {
    const id = r.translation?.id;
    if (typeof id !== "number" || id <= 0) continue;
    if (!map.has(id)) map.set(id, r);
  }
  const range = episodeTotal > 0 ? `1–${episodeTotal}` : "—";
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, r]) => ({
      id: String(id),
      name: String(r.translation?.title || `Перевод ${id}`).trim() || `Перевод ${id}`,
      range,
    }));
}

/** Ссылка iframe Kodik для выбранного перевода и серии (translationId null — первый результат с link). */
function kodikIframeSrc(list: KodikSearchResult[], translationId: number | null, episode: number): string | null {
  const pick =
    translationId != null
      ? list.find((r) => Number(r?.translation?.id) === translationId)
      : list.find((r) => typeof r?.link === "string");
  const base = pick && typeof pick.link === "string" ? pick.link.trim() : "";
  if (!base) return null;
  const ep = Math.max(1, Math.floor(episode) || 1);
  try {
    const out = new URL(base);
    out.hash = "";
    /* Сбрасываем параметры, из‑за которых вшитая ссылка Kodik открывает не первую серию */
    const strip = [
      "episode",
      "Episode",
      "ep",
      "seria",
      "serial_episode",
      "last_episode",
      "last",
      "continue",
      "continue_watching",
    ];
    for (const k of strip) {
      out.searchParams.delete(k);
    }
    out.searchParams.set("episode", String(ep));
    out.searchParams.set("only_episode", "true");
    return out.toString();
  } catch {
    return appendParams(base, { episode: String(ep), only_episode: "true" }) || base;
  }
}

async function kodikSearchList(shikiId: number): Promise<KodikSearchResult[]> {
  const t = DEFAULT_KODIK_TOKEN;
  const url = `https://kodik-api.com/search?token=${encodeURIComponent(t)}&shikimori_id=${encodeURIComponent(String(shikiId))}`;
  const r = await fetch(url, { method: "POST", headers: { Accept: "application/json" } });
  const j = (await r.json().catch(() => ({}))) as { results?: unknown; message?: unknown };
  if (!r.ok) {
    const msg = typeof j?.message === "string" ? j.message : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return Array.isArray(j?.results) ? (j.results as KodikSearchResult[]) : [];
}

const MOBILE_NAV_MQ = "(max-width: 767.98px)";

function useMobileNavBreakpoint() {
  const [isMobileNav, setIsMobileNav] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_NAV_MQ);
    const apply = () => setIsMobileNav(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return isMobileNav;
}

export function PlayerPage() {
  const [titleSearch, setTitleSearch] = useState(() => readLS(LAST_SHIKI_SEARCH_KEY));
  const [searchHits, setSearchHits] = useState<ShikiAnimeBrief[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<ShikiAnimeBrief | null>(null);
  const [chronology, setChronology] = useState<ChronologyEntry[]>([]);
  const [shikiBusy, setShikiBusy] = useState(false);

  const [results, setResults] = useState<KodikSearchResult[]>([]);
  const [selectedTranslationId, setSelectedTranslationId] = useState<number | "">("");
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string>("");
  const [status, setStatus] = useState<{ text: string; error: boolean }>(() => ({
    text: "Найдите аниме в Shikimori и выберите тайтл — если релиз есть на Kodik, плеер откроется сам.",
    error: false,
  }));
  const [buffering, setBuffering] = useState(false);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const isMobileNav = useMobileNavBreakpoint();
  const [currentEpisode, setCurrentEpisode] = useState(1);
  const [episodeDraft, setEpisodeDraft] = useState("1");

  const episodeTotal = useMemo(
    () => (selectedAnime ? episodeTotalFromShiki(selectedAnime) : 1),
    [selectedAnime],
  );

  const dubbingOptions = useMemo(
    () => dubbingFromKodik(results, episodeTotal),
    [results, episodeTotal],
  );

  useEffect(() => {
    if (!isMobileNav) setNavOpen(false);
  }, [isMobileNav]);

  useEffect(() => {
    if (!navOpen || !isMobileNav) {
      document.body.classList.remove("sh-nav-locked");
      return;
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("sh-nav-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("sh-nav-locked");
    };
  }, [navOpen, isMobileNav]);

  useEffect(() => {
    const ids = dubbingOptions.map((d) => d.id);
    if (ids.length === 0) {
      if (selectedTranslationId !== "") setSelectedTranslationId("");
      return;
    }
    const cur = selectedTranslationId === "" ? "" : String(selectedTranslationId);
    if (!cur || !ids.includes(cur)) {
      const first = Number(ids[0]);
      setSelectedTranslationId(Number.isFinite(first) && first > 0 ? first : "");
    }
  }, [dubbingOptions, selectedTranslationId]);

  const episodeMaxCap = episodeTotal > 0 ? episodeTotal : null;

  const clampEpisodeValue = useCallback(
    (raw: number) => {
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n)) return 1;
      const max = episodeMaxCap ?? Number.MAX_SAFE_INTEGER;
      return Math.min(max, Math.max(1, n));
    },
    [episodeMaxCap],
  );

  useEffect(() => {
    setCurrentEpisode(1);
  }, [selectedTranslationId]);

  useEffect(() => {
    setEpisodeDraft(String(currentEpisode));
  }, [currentEpisode]);

  const applyAnimeSelection = useCallback(async (a: ShikiAnimeBrief) => {
    setSelectedAnime(a);
    writeLS(LAST_SHIKI_ID_KEY, String(a.id));
    setTitleSearch(displayTitle(a));
    writeLS(LAST_SHIKI_SEARCH_KEY, displayTitle(a));
    setCurrentEpisode(1);
    setResults([]);
    setSelectedTranslationId("");
    setIframeSrc(null);
    setPlayingUrl("");
    setVideoErr(null);
    setChronology([]);
    setBusy(true);
    setStatus({ text: "Загружаем хронологию и ищем на Kodik…", error: false });

    try {
      const [chSettled, kodikSettled] = await Promise.allSettled([
        fetchChronology(a.id),
        kodikSearchList(a.id),
      ]);

      if (chSettled.status === "fulfilled") {
        setChronology(chSettled.value);
      } else {
        setChronology([]);
      }

      if (kodikSettled.status === "rejected") {
        const msg =
          kodikSettled.reason instanceof Error ? kodikSettled.reason.message : String(kodikSettled.reason);
        setResults([]);
        setSelectedTranslationId("");
        setStatus({
          text: `Не удалось получить Kodik: ${msg}`,
          error: true,
        });
        return;
      }

      const list = kodikSettled.value;

      if (!list.length) {
        setResults([]);
        setSelectedTranslationId("");
        setStatus({
          text: "К сожалению, на Kodik этого релиза нет.",
          error: false,
        });
        return;
      }

      const firstTr = list.find((x) => typeof x?.translation?.id === "number")?.translation?.id;
      const trForOpen: number | null = typeof firstTr === "number" ? firstTr : null;
      if (!kodikIframeSrc(list, trForOpen, 1)) {
        setResults([]);
        setSelectedTranslationId("");
        setStatus({
          text: "К сожалению, на Kodik этого релиза нет.",
          error: false,
        });
        return;
      }

      setResults(list);
      if (typeof firstTr === "number") setSelectedTranslationId(firstTr);
      else setSelectedTranslationId("");
      setStatus({
        text: STATUS_TELEGRAM_CTA,
        error: false,
      });
    } catch (e) {
      setChronology([]);
      setResults([]);
      setSelectedTranslationId("");
      setStatus({
        text: `Ошибка: ${String(e instanceof Error ? e.message : e)}`,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const launchId = parseLaunchShikiId();
    const lsId = safeInt(readLS(LAST_SHIKI_ID_KEY));
    const id = launchId ?? lsId;
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const a = await fetchAnimeById(id);
        if (cancelled) return;
        await applyAnimeSelection(a);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAnimeSelection]);

  const searchShikimori = useCallback(async () => {
    const q = String(titleSearch || "").trim();
    setSearchHits([]);
    if (!q) {
      setStatus({ text: "Введите название для поиска в Shikimori.", error: true });
      return;
    }
    setShikiBusy(true);
    setStatus({ text: "Ищу в Shikimori…", error: false });
    writeLS(LAST_SHIKI_SEARCH_KEY, q);
    try {
      const list = await searchAnimes(q, 20);
      setSearchHits(list);
      if (!list.length) {
        setStatus({ text: "Shikimori ничего не нашёл. Уточните запрос.", error: true });
        return;
      }
      setStatus({ text: `Shikimori: найдено ${list.length}. Выберите тайтл из списка.`, error: false });
    } catch (e) {
      setStatus({
        text: `Shikimori: ${String(e instanceof Error ? e.message : e)}`,
        error: true,
      });
    } finally {
      setShikiBusy(false);
    }
  }, [titleSearch]);

  const pickSearchHit = useCallback(
    async (a: ShikiAnimeBrief) => {
      setSearchHits([]);
      await applyAnimeSelection(a);
    },
    [applyAnimeSelection],
  );

  useEffect(() => {
    if (results.length === 0) {
      setIframeSrc(null);
      setPlayingUrl("");
      return;
    }
    const tr = typeof selectedTranslationId === "number" ? selectedTranslationId : null;
    const src = kodikIframeSrc(results, tr, currentEpisode);
    if (!src) {
      setIframeSrc(null);
      setPlayingUrl("");
      return;
    }
    setIframeSrc(src);
    setPlayingUrl(src);
  }, [results, selectedTranslationId, currentEpisode]);

  const goToEpisodeFromDraft = useCallback(() => {
    const parsed = parseInt(String(episodeDraft).trim(), 10);
    if (!Number.isFinite(parsed)) return;
    setCurrentEpisode(clampEpisodeValue(parsed));
  }, [episodeDraft, clampEpisodeValue]);

  const bumpEpisode = useCallback(
    (delta: number) => {
      setCurrentEpisode((ep) => clampEpisodeValue(ep + delta));
    },
    [clampEpisodeValue],
  );

  const onChronologyPick = useCallback(
    async (entry: ChronologyEntry) => {
      if (!entry.id.startsWith("anime-")) {
        setStatus({
          text: "Для Kodik выберите связанное аниме (не манга/ранобэ).",
          error: false,
        });
        return;
      }
      const raw = entry.id.slice("anime-".length);
      const id = Math.floor(Number(raw));
      if (!Number.isFinite(id) || id <= 0) return;
      setStatus({ text: `Загружаю «${entry.title}»…`, error: false });
      try {
        const a = await fetchAnimeById(id);
        await applyAnimeSelection(a);
      } catch (e) {
        setStatus({
          text: `Не удалось загрузить карточку: ${String(e instanceof Error ? e.message : e)}`,
          error: true,
        });
      }
    },
    [applyAnimeSelection],
  );

  const searchInputProps = {
    className: "sh-input" as const,
    placeholder: "Название аниме (Shikimori)",
    value: titleSearch,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setTitleSearch(e.target.value),
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void searchShikimori();
      }
    },
    "aria-label": "Поиск аниме в Shikimori",
  };

  const headerCard = (
    <div className="sh-card sh-header">
      <BrandTitle />
      {selectedAnime ? (
        <p className="sh-header-anime-title">{displayTitle(selectedAnime)}</p>
      ) : null}
      <p className="sh-header-telegram">
        Подпишитесь на наш телеграм-канал{" "}
        <a
          className="sh-telegram-channel-link"
          href={TELEGRAM_CHANNEL_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          sutekianime
        </a>
      </p>
    </div>
  );

  const searchToolbarDesktop = (
    <div className="sh-card sh-toolbar sh-toolbar--stack sh-search-desktop">
      <input {...searchInputProps} />
      <button type="button" className="sh-btn primary" onClick={() => void searchShikimori()} disabled={shikiBusy || busy}>
        Искать в Shikimori
      </button>
    </div>
  );

  const searchToolbarMobile = (
    <div className="sh-card sh-toolbar sh-toolbar--stack sh-toolbar--search-only sh-search-mobile">
      <input {...searchInputProps} enterKeyHint="search" inputMode="search" />
    </div>
  );

  const hitsToolbar =
    searchHits.length > 0 ? (
      <div className="sh-card sh-toolbar sh-toolbar--hits">
        <p className="sh-toolbar-hint">Результаты Shikimori — нажмите, чтобы выбрать:</p>
        <ul className="sh-shiki-hits" role="listbox" aria-label="Результаты поиска Shikimori">
          {searchHits.map((a) => (
            <li key={a.id} className="sh-shiki-hits__item" role="none">
              <button
                type="button"
                className={`sh-shiki-hit${selectedAnime?.id === a.id ? " is-active" : ""}`}
                role="option"
                onClick={() => void pickSearchHit(a)}
              >
                {displayTitle(a)}
                <span className="sh-shiki-hit__kind">
                  {kindLabel(a.kind)} · id {a.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const drawerControls = (
    <>
      {headerCard}
      {searchToolbarDesktop}
    </>
  );

  return (
    <main className="sh-page">
      <div
        className={`sh-drawer-backdrop${navOpen ? " is-open" : ""}`}
        onClick={() => setNavOpen(false)}
        role="presentation"
        aria-hidden={!navOpen}
      />

      <div className="sh-shell">
        <div className="sh-mobile-bar">
          <BrandTitle compact />
          <button
            type="button"
            className="sh-burger"
            aria-expanded={navOpen}
            aria-controls="sh-controls-panel"
            onClick={() => setNavOpen((v) => !v)}
          >
            <span className="sh-visually-hidden">Меню: бренд и подсказки</span>
            <span className="sh-burger-lines" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>

        {searchToolbarMobile}

        <div className="sh-controls-panel">
          <nav
            id="sh-controls-panel"
            className={`sh-controls-panel-inner${navOpen ? " is-open" : ""}`}
            aria-label="Меню"
            aria-hidden={isMobileNav ? !navOpen : false}
            inert={isMobileNav && !navOpen ? true : undefined}
          >
            {drawerControls}
          </nav>
        </div>

        {hitsToolbar}

        <div className="sh-card sh-player-card">
          <div className="sh-stage sh-stage--mylist-collapsed">
            <div className="sh-video-pane">
              <div className="sh-video-wrap">
                {iframeSrc ? (
                  <iframe
                    key={`${selectedAnime?.id ?? "0"}-${currentEpisode}-${iframeSrc}`}
                    title="Kodik"
                    className="sh-kodik-embed"
                    src={iframeSrc}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    onLoad={() => setBuffering(false)}
                  />
                ) : (
                  <div className="sh-video-placeholder">
                    <div className="sh-status" role="status">
                      Выберите тайтл в Shikimori — плеер появится, если релиз есть на Kodik.
                    </div>
                  </div>
                )}

                {buffering ? <div className="sh-buffer-overlay" aria-hidden /> : null}

                <div className="sh-hud-top sh-hud-top--end">
                  <div className="sh-hud-controls">
                    <button
                      type="button"
                      className="sh-mini-btn"
                      onClick={() => {
                        if (!iframeSrc) return;
                        setBuffering(true);
                        setIframeSrc(null);
                        setTimeout(() => setIframeSrc(playingUrl), 0);
                      }}
                      disabled={!iframeSrc}
                      title="Перезагрузить iframe"
                    >
                      Reload
                    </button>
                  </div>
                </div>
              </div>

              {iframeSrc && results.length > 0 ? (
                <div className="sh-episode-toolbar">
                  <span className="sh-episode-toolbar__label" id="sh-episode-label">
                    Серия
                  </span>
                  <div className="sh-episode-toolbar__controls" role="group" aria-labelledby="sh-episode-label">
                    <button
                      type="button"
                      className="sh-episode-step"
                      aria-label="Предыдущая серия"
                      disabled={currentEpisode <= 1}
                      onClick={() => bumpEpisode(-1)}
                    >
                      −
                    </button>
                    <input
                      className="sh-episode-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={episodeMaxCap ?? undefined}
                      aria-label="Номер серии"
                      value={episodeDraft}
                      onChange={(e) => setEpisodeDraft(e.target.value)}
                      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          goToEpisodeFromDraft();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="sh-episode-step"
                      aria-label="Следующая серия"
                      disabled={episodeMaxCap != null && currentEpisode >= episodeMaxCap}
                      onClick={() => bumpEpisode(1)}
                    >
                      +
                    </button>
                    <button type="button" className="sh-btn primary sh-episode-go" onClick={goToEpisodeFromDraft}>
                      Перейти
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={`sh-status${status.error ? " error" : ""}`} role={status.error ? "alert" : "status"}>
                {status.text === STATUS_TELEGRAM_CTA ? (
                  <span className="sh-player-cta">
                    Подпишитесь на наш телеграм-канал{" "}
                    <a
                      className="sh-telegram-channel-link"
                      href={TELEGRAM_CHANNEL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      sutekianime
                    </a>
                  </span>
                ) : (
                  status.text
                )}
              </div>

              {videoErr ? (
                <div className="sh-status error" role="alert">
                  {videoErr}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <WatchPanels chronology={chronology} onPickChronology={(entry) => void onChronologyPick(entry)} />
      </div>
    </main>
  );
}
