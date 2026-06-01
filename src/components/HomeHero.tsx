import { useEffect, useState } from "react";
import { fetchSeasonOngoings, type OngoingCard } from "../lib/seasonOngoings";
import { heroAssetUrl } from "../lib/posterPreload";
import { HomeSearch } from "./HomeSearch";

type HomeHeroProps = {
  onSelectAnime: (shikiId: number) => void;
};

const ROTATE_MS = 6500;

function kindLabel(kind: string | null | undefined): string {
  const k = (kind || "").toLowerCase();
  if (k === "tv") return "ТВ-сериал";
  if (k === "movie") return "Фильм";
  if (k === "ova") return "OVA";
  if (k === "ona") return "ONA";
  if (k === "special") return "Спешл";
  return kind ? kind.toUpperCase() : "";
}

const NAV_LINKS = ["Главная", "Аниме", "Расписание", "Подборки", "Сообщество"];

export function HomeHero({ onSelectAnime }: HomeHeroProps) {
  const [slides, setSlides] = useState<OngoingCard[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchSeasonOngoings(6)
      .then((rows) => {
        if (!cancelled) setSlides(rows);
      })
      .catch(() => {
        /* hero просто останется с тёмным фоном */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    slides.forEach((s) => {
      const img = new Image();
      img.src = heroAssetUrl(s.anime_id);
    });
  }, [slides]);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => {
      setActive((a) => (a + 1) % slides.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [slides.length]);

  const current = slides[active] ?? null;

  return (
    <header className="hero">
      <div className="hero__bgs" aria-hidden="true">
        {slides.map((s, i) => (
          <div
            key={s.anime_id}
            className={`hero__bg${i === active ? " hero__bg--on" : ""}`}
            style={{ backgroundImage: `url(${heroAssetUrl(s.anime_id)})` }}
          />
        ))}
        <div className="hero__scrim" />
      </div>

      <div className="home-topbar hero__topbar">
        <div className="sh-search-brand home-topbar__brand" aria-label="Suteki Hub">
          <span className="sh-brand-suteki">SUTEKI</span>
          <span className="sh-brand-hub">hub</span>
        </div>

        <nav className="home-topbar__nav" aria-label="Навигация">
          {NAV_LINKS.map((l) => (
            <a key={l} className="home-topbar__link" href="#">
              {l}
            </a>
          ))}
        </nav>

        <div className="home-topbar__actions" aria-label="Действия">
          <div className="home-topbar__search">
            <HomeSearch onOpenAnime={onSelectAnime} />
          </div>
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

      <div className="hero__content">
        {current ? (
          <button
            type="button"
            className="hero__slide"
            onClick={() => onSelectAnime(current.anime_id)}
          >
            <span className="hero__eyebrow">Популярное в этом сезоне</span>
            <span className="hero__title">{current.title}</span>
            <span className="hero__meta">
              {current.score && Number(current.score) > 0 ? (
                <span className="hero__score">★ {current.score}</span>
              ) : null}
              {kindLabel(current.kind) ? <span className="hero__chip">{kindLabel(current.kind)}</span> : null}
              <span className="hero__chip hero__chip--live">Онгоинг</span>
            </span>
            <span className="hero__cta">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
              Смотреть
            </span>
          </button>
        ) : (
          <div className="hero__slide hero__slide--loading" aria-busy="true" />
        )}
      </div>

      {slides.length > 1 ? (
        <div className="hero__dots" role="tablist" aria-label="Слайды">
          {slides.map((s, i) => (
            <button
              key={s.anime_id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Слайд ${i + 1}`}
              className={`hero__dot${i === active ? " hero__dot--on" : ""}`}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      ) : null}
    </header>
  );
}
