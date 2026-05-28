import { useCallback, useEffect, useState } from "react";
import { loadContinueWatching } from "../lib/homeContinue";
import { posterAssetUrl } from "../lib/posterPreload";
import { formatClockSec, type ContinueWatchEntry } from "../lib/watchProgress";
import { PosterImage } from "./PosterImage";

type HomeContinueWatchingProps = {
  onContinue: (entry: ContinueWatchEntry) => void;
};

export function HomeContinueWatching({ onContinue }: HomeContinueWatchingProps) {
  const [items, setItems] = useState<ContinueWatchEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    void loadContinueWatching(12)
      .then((rows) => setItems(rows))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("sh.last:v1:") || e.key?.startsWith("sh.resume:v1:")) {
        reload();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", reload);
    };
  }, [reload]);

  if (!loading && items.length === 0) return null;

  return (
    <section className="sh-card home-continue home-enter home-enter--15" aria-labelledby="home-continue-title">
      <div className="home-section-head">
        <div>
          <h2 id="home-continue-title" className="home-section-head__title">
            Продолжить просмотр
          </h2>
          <p className="home-section-head__sub">С того места, где остановились</p>
        </div>
      </div>

      {loading ? (
        <p className="home-continue__state" aria-busy="true">
          Загрузка…
        </p>
      ) : (
        <div className="home-continue-strip" role="list" aria-label="Продолжить просмотр">
          {items.map((item, index) => (
            <button
              key={`${item.animeId}-${item.translationId}-${item.episode}`}
              type="button"
              role="listitem"
              className="home-continue-card"
              onClick={() => onContinue(item)}
            >
              <span className="home-continue-card__poster" aria-hidden="true">
                <PosterImage
                  src={item.poster || posterAssetUrl(item.animeId)}
                  width={40}
                  height={56}
                  loading={index < 4 ? "eager" : "lazy"}
                  fetchPriority={index < 2 ? "high" : undefined}
                  instant={index < 3}
                />
              </span>
              <span className="home-continue-card__body">
                <span className="home-continue-card__title">{item.title}</span>
                <span className="home-continue-card__progress">
                  Сер. {item.episode} · {formatClockSec(item.positionSec)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
