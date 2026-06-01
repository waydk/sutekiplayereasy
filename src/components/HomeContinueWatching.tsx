import { useCallback, useEffect, useState } from "react";
import { loadContinueWatching } from "../lib/homeContinue";
import { useJikanMeta } from "../lib/jikanImages";
import { posterAssetUrl } from "../lib/posterPreload";
import { formatClockSec, type ContinueWatchEntry } from "../lib/watchProgress";
import { PosterImage } from "./PosterImage";

type HomeContinueWatchingProps = {
  onContinue: (entry: ContinueWatchEntry) => void;
};

const MIN_RESUME_SEC = 5;

function ContinueCard({
  item,
  index,
  onContinue,
}: {
  item: ContinueWatchEntry;
  index: number;
  onContinue: (entry: ContinueWatchEntry) => void;
}) {
  const meta = useJikanMeta(item.animeId);
  const src = meta ? meta.image || item.poster || posterAssetUrl(item.animeId) : null;

  const hasResume = item.positionSec > MIN_RESUME_SEC;
  const barWidth = item.percent != null && item.percent > 0 ? item.percent : hasResume ? 6 : 0;

  return (
    <button
      type="button"
      role="listitem"
      className="home-continue-card"
      onClick={() => onContinue(item)}
      title={`${item.title} — серия ${item.episode}`}
    >
      <span className="home-continue-card__thumb">
        {src ? (
          <PosterImage
            src={src}
            fallbackSrc={item.poster || posterAssetUrl(item.animeId)}
            width={240}
            height={135}
            loading={index < 4 ? "eager" : "lazy"}
            fetchPriority={index < 2 ? "high" : undefined}
            instant={index < 3}
          />
        ) : (
          <span className="home-continue-card__thumb-sk" />
        )}
        <span className="home-continue-card__ep-badge" aria-hidden="true">
          Серия {item.episode}
        </span>
        <span className="home-continue-card__play" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </span>
        {barWidth > 0 ? (
          <span className="home-continue-card__bar" aria-hidden="true">
            <span className="home-continue-card__bar-fill" style={{ width: `${barWidth}%` }} />
          </span>
        ) : null}
      </span>
      <span className="home-continue-card__body">
        <span className="home-continue-card__title">{item.title}</span>
        <span className="home-continue-card__meta">
          {hasResume
            ? `Продолжить с ${formatClockSec(item.positionSec)}`
            : `Серия ${item.episode} · с начала`}
        </span>
      </span>
    </button>
  );
}

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
            <ContinueCard
              key={`${item.animeId}-${item.translationId}-${item.episode}`}
              item={item}
              index={index}
              onContinue={onContinue}
            />
          ))}
        </div>
      )}
    </section>
  );
}
