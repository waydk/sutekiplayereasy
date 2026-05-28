import { useCallback } from "react";
import { HomeCalendar } from "./components/HomeCalendar";
import { HomeContinueWatching } from "./components/HomeContinueWatching";
import { HomeSearch } from "./components/HomeSearch";
import { PosterImage } from "./components/PosterImage";
import { posterAssetUrl } from "./lib/posterPreload";
import type { ContinueWatchEntry } from "./lib/watchProgress";
import { formatRank, RECOMMENDED_ANIME } from "./lib/topAnime";

type HomePageProps = {
  onSelectAnime: (shikiId: number) => void;
  onContinueWatch: (entry: ContinueWatchEntry) => void;
};

function PlayIcon() {
  return (
    <svg className="home-card__play-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

export function HomePage({ onSelectAnime, onContinueWatch }: HomePageProps) {
  const handleKey = useCallback(
    (e: React.KeyboardEvent, shikiId: number) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectAnime(shikiId);
      }
    },
    [onSelectAnime],
  );

  const quickLinks = RECOMMENDED_ANIME.slice(0, 5);

  return (
    <main className="sh-page home-page">
      <div className="sh-shell home-shell">
        <header className="sh-card sh-search home-hero home-enter">
          <div className="home-hero__bg" aria-hidden="true" />

          <div className="home-topbar">
            <div className="sh-search-brand home-topbar__brand" aria-label="Suteki Hub">
              <span className="sh-brand-suteki">SUTEKI</span>
              <span className="sh-brand-hub">hub</span>
            </div>

            <nav className="home-topbar__nav" aria-label="Навигация">
              <a className="home-topbar__link" href="#">
                Главная
              </a>
              <a className="home-topbar__link" href="#">
                Аниме
              </a>
              <a className="home-topbar__link" href="#">
                Расписание
              </a>
              <a className="home-topbar__link" href="#">
                Подборки
              </a>
              <a className="home-topbar__link" href="#">
                Сообщество
              </a>
            </nav>

            <div className="home-topbar__actions" aria-label="Действия">
              <button type="button" className="home-topbar__icon" aria-label="Поиск">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M10.5 3a7.5 7.5 0 1 1 4.7 13.3l4.5 4.5a1 1 0 0 1-1.4 1.4l-4.5-4.5A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button type="button" className="home-topbar__icon" aria-label="Профиль">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 12a4.2 4.2 0 1 0-4.2-4.2A4.2 4.2 0 0 0 12 12Zm0 2c-4.1 0-7.5 2.2-7.5 5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1c0-2.8-3.4-5-7.5-5Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="home-hero__content">
            <h1 className="home-hero__title">
              Открой мир <span className="home-hero__accent">аниме</span> заново
            </h1>
            <p className="sh-subtitle home-hero__lead">
              Твои любимые истории, персонажи и вселенные — всё в одном месте.
            </p>

            <HomeSearch onOpenAnime={onSelectAnime} />

            <div className="home-hero__chips" aria-label="Быстрый выбор">
              {quickLinks.map((a) => (
                <button
                  key={a.shikiId}
                  type="button"
                  className="home-hero__chip"
                  onClick={() => onSelectAnime(a.shikiId)}
                >
                  {a.title}
                </button>
              ))}
            </div>
          </div>
        </header>

        <HomeContinueWatching onContinue={onContinueWatch} />

        <section className="sh-card home-rec home-enter home-enter--2" aria-labelledby="home-rec-title">
          <div className="home-section-head">
            <div>
              <h2 id="home-rec-title" className="home-section-head__title">
                Рекомендации
              </h2>
              <p className="home-section-head__sub">Популярные тайтлы — нажми, чтобы открыть плеер</p>
            </div>
          </div>

          <ol className="home-grid" aria-label="Рекомендации">
            {RECOMMENDED_ANIME.map((anime, index) => (
              <li key={anime.shikiId} className="home-grid__item">
                <button
                  type="button"
                  className={`home-card home-card--${anime.variant}`}
                  onClick={() => onSelectAnime(anime.shikiId)}
                  onKeyDown={(e) => handleKey(e, anime.shikiId)}
                >
                  <span className="home-card__year" aria-hidden="true">
                    \ {anime.year}
                  </span>

                  <span className="home-card__rank" aria-hidden="true">
                    {formatRank(anime.rank)}
                  </span>

                  <span className="home-card__title-ja" aria-hidden="true">
                    {anime.titleJa}
                  </span>

                  <span className="home-card__info">
                    <span className="home-card__title">{anime.title}</span>
                    <span className="home-card__genres">{anime.genres}</span>
                    <span className="home-card__cta">
                      <span className="home-card__watch">
                        <PlayIcon />
                        Смотреть
                      </span>
                      <span className="home-card__eps">{anime.episodesLabel}</span>
                    </span>
                  </span>

                  <span className="home-card__art" aria-hidden="true">
                    <PosterImage
                      src={posterAssetUrl(anime.shikiId)}
                      width={480}
                      height={280}
                      loading={index < 6 ? "eager" : "lazy"}
                      fetchPriority={index < 3 ? "high" : undefined}
                      instant={index < 4}
                      className="home-card__poster"
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <HomeCalendar onSelectAnime={onSelectAnime} />

        <p className="home-foot home-enter home-enter--4">
          Постеры —{" "}
          <a href="https://shikimori.one" target="_blank" rel="noopener noreferrer">
            Shikimori
          </a>
        </p>
      </div>
    </main>
  );
}
