import { useCallback } from "react";
import { HomeCalendar } from "./components/HomeCalendar";
import { HomeSearch } from "./components/HomeSearch";
import { PosterImage } from "./components/PosterImage";
import { calendarPosterSrc } from "./lib/homePreload";
import { formatRank, RECOMMENDED_ANIME } from "./lib/topAnime";

type HomePageProps = {
  onSelectAnime: (shikiId: number) => void;
};

function PlayIcon() {
  return (
    <svg className="home-card__play-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" fill="currentColor" />
    </svg>
  );
}

export function HomePage({ onSelectAnime }: HomePageProps) {
  const handleKey = useCallback(
    (e: React.KeyboardEvent, shikiId: number) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectAnime(shikiId);
      }
    },
    [onSelectAnime],
  );

  return (
    <main className="sh-page home-page">
      <div className="sh-shell home-shell">
        <header className="sh-card sh-search home-hero home-enter">
          <div className="sh-search-brand" aria-label="Suteki Hub">
            <span className="sh-brand-suteki">SUTEKI</span>
            <span className="sh-brand-hub">hub</span>
          </div>

          <p className="sh-subtitle home-hero__lead">
            Найди аниме и сразу начни смотреть — поиск, рекомендации и расписание на сегодня.
          </p>

          <HomeSearch onOpenAnime={onSelectAnime} />
        </header>

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
                      src={calendarPosterSrc(anime.shikiId)}
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
