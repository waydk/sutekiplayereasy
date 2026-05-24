import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeSearchQuery,
  searchAnime,
  SEARCH_DEBOUNCE_MS,
  type AnimeSearchRow,
} from "../lib/animeSearch";
import { posterAssetUrl } from "../lib/posterPreload";
import { PosterImage } from "./PosterImage";

type HomeSearchProps = {
  onOpenAnime: (shikiId: number) => void;
};

export function HomeSearch({ onOpenAnime }: HomeSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnimeSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);

  const reqIdRef = useRef(0);
  const lastDebouncedRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(async (raw: string) => {
    const q = normalizeSearchQuery(raw);
    if (!q) {
      setResults([]);
      setError(null);
      setDone(false);
      setOpen(false);
      return;
    }

    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setOpen(true);
    try {
      const rows = await searchAnime(q, 12);
      if (reqId !== reqIdRef.current) return;
      setResults(rows);
      setDone(true);
    } catch (e) {
      if (reqId !== reqIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
      setDone(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  const openResult = useCallback(
    (row: AnimeSearchRow) => {
      const id = Number(row.anime_id);
      if (!Number.isFinite(id) || id <= 0) return;
      setOpen(false);
      setQuery(row.title || "");
      onOpenAnime(id);
    },
    [onOpenAnime],
  );

  const submit = useCallback(() => {
    const q = normalizeSearchQuery(query);
    if (!q) return;
    if (results.length >= 1) {
      openResult(results[0]);
      return;
    }
    void runSearch(q);
  }, [openResult, query, results, runSearch]);

  useEffect(() => {
    const q = normalizeSearchQuery(query);
    if (!q) {
      lastDebouncedRef.current = "";
      setResults([]);
      setError(null);
      setDone(false);
      setOpen(false);
      return;
    }
    if (q === lastDebouncedRef.current) return;
    const t = setTimeout(() => {
      lastDebouncedRef.current = q;
      void runSearch(q);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const showPanel = open && normalizeSearchQuery(query).length > 0;

  return (
    <div className="home-search" role="search">
      <div className="sh-search-row">
        <input
          id="home-search-input"
          ref={inputRef}
          type="search"
          className="sh-input"
          placeholder="Введите название аниме…"
          value={query}
          autoComplete="off"
          inputMode="search"
          enterKeyHint="search"
          aria-label="Поиск аниме"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls="home-search-results"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (normalizeSearchQuery(query)) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        <button
          type="button"
          className={`sh-btn primary${loading ? " loading" : ""}`}
          onClick={submit}
          disabled={loading || !normalizeSearchQuery(query)}
        >
          {loading ? <span className="sh-spinner" aria-hidden="true" /> : null}
          Смотреть
        </button>
      </div>

      {showPanel ? (
        <div id="home-search-results" className="home-search__panel" role="listbox">
          {error ? (
            <p className="home-search__msg home-search__msg--error" role="alert">
              Ошибка поиска. Попробуйте ещё раз.
            </p>
          ) : null}

          {!error && done && !loading && results.length === 0 ? (
            <p className="home-search__msg" role="status">
              Ничего не найдено
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul className="home-search__list">
              {results.map((row) => (
                <li key={row.anime_id}>
                  <button
                    type="button"
                    role="option"
                    className="home-search__item"
                    onClick={() => openResult(row)}
                  >
                    <span className="home-search__poster" aria-hidden="true">
                      <PosterImage
                        src={row.poster || posterAssetUrl(row.anime_id)}
                        width={44}
                        height={62}
                        loading="lazy"
                      />
                    </span>
                    <span className="home-search__text">
                      <span className="home-search__title">{row.title || `#${row.anime_id}`}</span>
                      {row.original_title && row.original_title !== row.title ? (
                        <span className="home-search__sub">{row.original_title}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {loading ? (
            <p className="home-search__msg" aria-busy="true">
              Поиск…
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
