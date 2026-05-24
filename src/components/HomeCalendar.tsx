import { useEffect, useState } from "react";
import { PosterImage } from "./PosterImage";
import { calendarPosterSrc, ensureHomeCalendar } from "../lib/homePreload";
import type { CalendarAiringItem, TodayCalendarPayload } from "../lib/homeCalendar";

type HomeCalendarProps = {
  onSelectAnime: (shikiId: number) => void;
};

function kindLabel(kind: string | null | undefined): string {
  const k = (kind || "").toLowerCase();
  if (k === "tv") return "TV";
  if (k === "movie") return "Фильм";
  if (k === "ova") return "OVA";
  if (k === "ona") return "ONA";
  if (k === "special") return "Спешл";
  return kind ? kind.toUpperCase() : "";
}

function CalendarSkeleton() {
  return (
    <div className="home-cal__skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="home-cal__sk-row" style={{ ["--home-i" as string]: i }} />
      ))}
    </div>
  );
}

export function HomeCalendar({ onSelectAnime }: HomeCalendarProps) {
  const [data, setData] = useState<TodayCalendarPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void ensureHomeCalendar()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить календарь Shikimori");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = (item: CalendarAiringItem) => {
    if (item.anime_id > 0) onSelectAnime(item.anime_id);
  };

  return (
    <section className="sh-card home-cal home-enter home-enter--3" aria-labelledby="home-cal-title">
      <header className="home-cal__head">
        <div>
          <h2 id="home-cal-title" className="home-cal__title">
            Сегодня выходят
          </h2>
          <p className="home-cal__sub">
            {data ? (
              <>
                {data.date_label}, {data.weekday} · по календарю{" "}
                <a href="https://shikimori.one" target="_blank" rel="noopener noreferrer">
                  Shikimori
                </a>
              </>
            ) : (
              "Расписание серий на сегодня"
            )}
          </p>
        </div>
        {data ? (
          <span className="home-cal__badge" aria-label={`${data.count} серий`}>
            {data.count}
          </span>
        ) : null}
      </header>

      {loading ? (
        <>
          <p className="home-cal__state" aria-busy="true">
            Загрузка календаря…
          </p>
          <CalendarSkeleton />
        </>
      ) : null}

      {error ? <p className="home-cal__state home-cal__state--error">{error}</p> : null}

      {!loading && !error && data && data.items.length === 0 ? (
        <p className="home-cal__state">Сегодня по календарю Shikimori нет запланированных серий.</p>
      ) : null}

      {!loading && !error && data && data.items.length > 0 ? (
        <ol className="home-cal__list">
          {data.items.map((item, index) => (
            <li
              key={`${item.anime_id}-${item.episode}-${item.airs_at}`}
              className="home-cal__item home-cal__item--ready"
              style={{ ["--home-i" as string]: index }}
            >
              <button type="button" className="home-cal__row" onClick={() => open(item)}>
                <span className="home-cal__time">{item.airs_time}</span>
                <span className="home-cal__poster" aria-hidden="true">
                  <PosterImage
                    src={calendarPosterSrc(item.anime_id)}
                    width={56}
                    height={76}
                    loading="eager"
                    fetchPriority={index < 6 ? "high" : undefined}
                    instant={index < 6}
                  />
                </span>
                <span className="home-cal__body">
                  <span className="home-cal__anime-title">{item.title}</span>
                  <span className="home-cal__meta">
                    {item.episode != null ? (
                      <span className="home-cal__ep">Серия {item.episode}</span>
                    ) : null}
                    {kindLabel(item.kind) ? (
                      <span className="home-cal__kind">{kindLabel(item.kind)}</span>
                    ) : null}
                  </span>
                </span>
                <span className="home-cal__go" aria-hidden="true">
                  ▶
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
