import { useCallback, useEffect, useRef, useState } from "react";
import type { ChronologyEntry } from "./shikimoriApi";

type WatchPanelsProps = {
  chronology: ChronologyEntry[];
  onPickChronology?: (entry: ChronologyEntry) => void;
};

function ChevronCarousel({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      {dir === "prev" ? <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function WatchPanels({ chronology, onPickChronology }: WatchPanelsProps) {
  const [activeChronoId, setActiveChronoId] = useState<string | null>(null);
  const chronoScrollRef = useRef<HTMLDivElement>(null);
  const [chronoNav, setChronoNav] = useState({ prev: false, next: true });

  const updateChronoNav = useCallback(() => {
    const el = chronoScrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 4) {
      setChronoNav({ prev: false, next: false });
      return;
    }
    setChronoNav({
      prev: el.scrollLeft > 4,
      next: el.scrollLeft < max - 4,
    });
  }, []);

  const scrollChrono = useCallback((dir: -1 | 1) => {
    const el = chronoScrollRef.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.72, 160);
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  useEffect(() => {
    setActiveChronoId(null);
  }, [chronology]);

  useEffect(() => {
    const el = chronoScrollRef.current;
    if (!el || chronology.length === 0) return;
    updateChronoNav();
    const ro = new ResizeObserver(() => updateChronoNav());
    ro.observe(el);
    el.addEventListener("scroll", updateChronoNav, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateChronoNav);
    };
  }, [chronology, updateChronoNav]);

  const posterFallback =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"><rect fill="#1a1d26" width="200" height="300"/><text fill="#6b6f80" font-family="system-ui" font-size="14" x="100" y="150" text-anchor="middle">Нет постера</text></svg>`,
    );

  return (
    <section className="sh-card sh-watch-section" aria-labelledby="sh-watch-chrono-title">
      <header className="sh-watch-head">
        <h2 id="sh-watch-chrono-title" className="sh-watch-head__title">
          Хронология
        </h2>
        <span className="sh-watch-head__badge" aria-label={`Связанных записей: ${chronology.length}`}>
          {chronology.length}
        </span>
      </header>
      {chronology.length === 0 ? (
        <p className="sh-watch-empty">Нет данных из Shikimori /related для этого тайтла.</p>
      ) : (
        <div className="sh-chrono-carousel">
          <button
            type="button"
            className={`sh-chrono-nav sh-chrono-nav--prev${chronoNav.prev ? "" : " is-disabled"}`}
            onClick={() => scrollChrono(-1)}
            disabled={!chronoNav.prev}
            aria-label="Прокрутить хронологию назад"
          >
            <ChevronCarousel dir="prev" />
          </button>
          <div
            className="sh-chrono-scroll"
            ref={chronoScrollRef}
            tabIndex={0}
            role="region"
            aria-label="Карусель связанных тайтлов"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                if (chronoNav.prev) scrollChrono(-1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                if (chronoNav.next) scrollChrono(1);
              }
            }}
          >
            <ul className="sh-chrono-track">
              {chronology.map((item) => {
                const active = item.id === activeChronoId;
                return (
                  <li key={item.id} className="sh-chrono-track__item">
                    <button
                      type="button"
                      className={`sh-chrono-card${active ? " is-active" : ""}`}
                      onClick={() => {
                        setActiveChronoId(item.id);
                        onPickChronology?.(item);
                      }}
                    >
                      <div className="sh-chrono-card__media">
                        <img
                          src={item.posterUrl || posterFallback}
                          alt={`Постер: ${item.title}`}
                          width={140}
                          height={210}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <div className="sh-chrono-card__body">
                        <p className="sh-chrono-card__title">{item.title}</p>
                        <p className="sh-chrono-card__meta">
                          {[item.relation, `${item.kindLabel} • ${item.year}`].filter(Boolean).join(" • ")}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <button
            type="button"
            className={`sh-chrono-nav sh-chrono-nav--next${chronoNav.next ? "" : " is-disabled"}`}
            onClick={() => scrollChrono(1)}
            disabled={!chronoNav.next}
            aria-label="Прокрутить хронологию вперёд"
          >
            <ChevronCarousel dir="next" />
          </button>
        </div>
      )}
    </section>
  );
}
