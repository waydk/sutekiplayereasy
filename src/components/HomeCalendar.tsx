import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCalendarWeek, type CalWeekItem, type CalWeekPayload } from "../lib/homeCalendarWeek";

type HomeCalendarProps = {
  onSelectAnime: (shikiId: number) => void;
};

const VISIBLE_STEP = 7;

function formatMskClock(d: Date): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return "";
  }
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
  const [week, setWeek] = useState<CalWeekPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(VISIBLE_STEP);
  const [now, setNow] = useState(() => new Date());
  const datesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCalendarWeek()
      .then((payload) => {
        if (cancelled) return;
        setWeek(payload);
        setSelected(payload.today || payload.days[0]?.date || null);
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

  const activeDay = useMemo(
    () => week?.days.find((d) => d.date === selected) ?? null,
    [week, selected],
  );

  useEffect(() => {
    setVisible(VISIBLE_STEP);
  }, [selected]);

  const open = (item: CalWeekItem) => {
    if (item.anime_id > 0) onSelectAnime(item.anime_id);
  };

  const scrollDates = (dir: 1 | -1) => {
    const el = datesRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(220, el.clientWidth * 0.7), behavior: "smooth" });
  };

  const items = activeDay?.items ?? [];
  const shown = items.slice(0, visible);

  return (
    <section className="sh-card home-cal home-enter home-enter--3" aria-labelledby="home-cal-title">
      <header className="home-cal__head">
        <h2 id="home-cal-title" className="home-cal__title">
          Расписание выхода
          <span className="home-cal__clock"> · Сейчас: {formatMskClock(now)}</span>
        </h2>
      </header>

      {week && week.days.length > 0 ? (
        <div className="home-cal__nav">
          <button
            type="button"
            className="home-cal__arrow"
            onClick={() => scrollDates(-1)}
            aria-label="Раньше"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="home-cal__dates" ref={datesRef} role="tablist" aria-label="Выбор даты">
            {week.days.map((d) => (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={d.date === selected}
                className={`home-cal__date${d.date === selected ? " home-cal__date--active" : ""}`}
                onClick={() => setSelected(d.date)}
              >
                <span className="home-cal__date-top">{d.date_label.toUpperCase()}</span>
                <span className="home-cal__date-wd">
                  {d.is_today ? "СЕГОДНЯ" : d.weekday_short.toUpperCase()}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="home-cal__arrow"
            onClick={() => scrollDates(1)}
            aria-label="Позже"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : null}

      {loading ? (
        <>
          <p className="home-cal__state" aria-busy="true">
            Загрузка календаря…
          </p>
          <CalendarSkeleton />
        </>
      ) : null}

      {error ? <p className="home-cal__state home-cal__state--error">{error}</p> : null}

      {!loading && !error && activeDay && items.length === 0 ? (
        <p className="home-cal__state">На этот день по календарю Shikimori нет запланированных серий.</p>
      ) : null}

      {!loading && !error && shown.length > 0 ? (
        <>
          <ol className="home-cal__list" aria-label={`Серии на ${activeDay?.date_label}`}>
            {shown.map((item, index) => (
              <li
                key={`${item.anime_id}-${item.episode}-${item.airs_at}`}
                className="home-cal__item home-cal__item--ready"
                style={{ ["--home-i" as string]: index }}
              >
                <button type="button" className="home-cal__row" onClick={() => open(item)}>
                  <span className="home-cal__time">{item.airs_time}</span>
                  <span className="home-cal__row-title">{item.title}</span>
                  <span className="home-cal__ep-btn">
                    <svg className="home-cal__ep-play" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" fill="currentColor" />
                    </svg>
                    {item.episode != null ? `Серия ${item.episode}` : "Смотреть"}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {items.length > visible ? (
            <button
              type="button"
              className="home-cal__more"
              onClick={() => setVisible((v) => v + VISIBLE_STEP)}
            >
              Показать ещё
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
