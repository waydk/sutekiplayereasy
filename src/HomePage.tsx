import { useCallback, useEffect } from "react";
import { HomeCalendar } from "./components/HomeCalendar";
import { HomeSearch } from "./components/HomeSearch";
import { PosterImage } from "./components/PosterImage";
import { calendarPosterSrc } from "./lib/homePreload";
import { formatRank, RECOMMENDED_ANIME } from "./lib/topAnime";

type HomePageProps = {
  onSelectAnime: (shikiId: number) => void;
};

export function HomePage({ onSelectAnime }: HomePageProps) {
  useEffect(() => {
    document.body.classList.add("home-root");
    return () => document.body.classList.remove("home-root");
  }, []);

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

          <ol className="home-picks" aria-label="Рекомендации">
            {RECOMMENDED_ANIME.map((anime, index) => (
              <li
                key={anime.shikiId}
                className="home-picks__item"
                style={{ ["--home-i" as string]: index }}
              >
                <button
                  type="button"
                  className="home-pick"
                  onClick={() => onSelectAnime(anime.shikiId)}
                  onKeyDown={(e) => handleKey(e, anime.shikiId)}
                >
                  <span className="home-pick__poster" aria-hidden="true">
                    <PosterImage
                      src={calendarPosterSrc(anime.shikiId)}
                      width={240}
                      height={360}
                      loading={index < 6 ? "eager" : "lazy"}
                      fetchPriority={index < 3 ? "high" : index < 6 ? "auto" : undefined}
                    />
                    <span className="home-pick__rank">{formatRank(anime.rank)}</span>
                    <span className="home-pick__overlay" aria-hidden="true">
                      <span className="home-pick__play" aria-hidden="true">
                        ▶
                      </span>
                    </span>
                  </span>

                  <span className="home-pick__body">
                    <span className="home-pick__title">{anime.title}</span>
                    <span className="home-pick__meta">
                      <span className="home-pick__year">{anime.year}</span>
                      <span className="home-pick__dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="home-pick__eps">{anime.episodesLabel}</span>
                    </span>
                    <span className="home-pick__genres">{anime.genres}</span>
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
